// tools/apps/system.ts
// Cross-platform system-wide operations supporting macOS, Windows, and Linux

import os from "os";
import path from "path";
import { exec } from "child_process";
import { getPlatform, execAppleScript, execPowerShell, execShell } from "./utils.js";

/**
 * Resolves a path that may contain relative paths or home (~) directories.
 */
function resolvePath(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return path.resolve(os.homedir(), inputPath.slice(2));
  }
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(process.cwd(), inputPath);
}

/**
 * Launches Visual Studio Code into the target folder (Cross-Platform).
 */
export async function launchVsCode(folderPath: string): Promise<string> {
  const resolved = resolvePath(folderPath);
  const cleanPath = resolved.replace(/"/g, '\\"');
  const platform = getPlatform();

  if (platform === "darwin") {
    try {
      const script = `
        tell application "Visual Studio Code"
          open "${cleanPath}"
          activate
        end tell
      `;
      await execAppleScript(script);
      return `✅ Launched Visual Studio Code at: ${resolved}`;
    } catch {
      // Fallback to CLI launch
    }
  }

  if (platform === "win32") {
    try {
      await execPowerShell(`code "${cleanPath}"`);
      return `✅ Launched Visual Studio Code at: ${resolved}`;
    } catch {
      // Try default installation path fallback
      const defaultWinPath = path.resolve(os.homedir(), "AppData/Local/Programs/Microsoft VS Code/bin/code.cmd");
      return new Promise((resolve, reject) => {
        exec(`"${defaultWinPath}" "${cleanPath}"`, (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`Failed to launch VS Code: ${stderr.trim() || err.message}`));
          } else {
            resolve(`✅ Launched Visual Studio Code at: ${resolved}`);
          }
        });
      });
    }
  }

  // Linux launch
  try {
    await execShell(`code "${cleanPath}"`);
    return `✅ Launched Visual Studio Code at: ${resolved}`;
  } catch (err: any) {
    throw new Error(`Failed to launch VS Code on Linux: ${err.message}`);
  }
}

/**
 * Controls background services like Ollama (Cross-Platform).
 */
export async function controlService(serviceName: string, state: "start" | "stop"): Promise<string> {
  const service = serviceName.toLowerCase();
  const platform = getPlatform();

  if (service === "ollama") {
    if (state === "start") {
      if (platform === "darwin") {
        try {
          await execAppleScript('tell application "Ollama" to activate');
          return "✅ Ollama service started successfully (launched Ollama.app).";
        } catch {
          const { spawn } = await import("child_process");
          const proc = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
          proc.unref();
          return "✅ Ollama CLI service started in the background.";
        }
      }

      if (platform === "win32") {
        try {
          // Attempt standard Ollama installer path first
          const ollamaExe = path.resolve(os.homedir(), "AppData/Local/Programs/Ollama/Ollama.exe");
          await execPowerShell(`Start-Process "${ollamaExe}"`);
          return "✅ Ollama application launched.";
        } catch {
          // Fallback to standard CLI service
          await execPowerShell("Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden");
          return "✅ Ollama CLI service started.";
        }
      }

      // Linux launch
      try {
        await execShell("systemctl start ollama");
        return "✅ Ollama service started (via systemctl).";
      } catch {
        const { spawn } = await import("child_process");
        const proc = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
        proc.unref();
        return "✅ Ollama CLI service started in the background.";
      }
    } else {
      // STOP SERVICE
      if (platform === "darwin") {
        try {
          await execAppleScript('tell application "Ollama" to quit');
        } catch {}
        await execShell("pkill ollama");
        return "✅ Ollama service stopped.";
      }

      if (platform === "win32") {
        await execPowerShell("Stop-Process -Name 'ollama' -Force -ErrorAction SilentlyContinue");
        await execPowerShell("taskkill /F /IM ollama.exe /T");
        return "✅ Ollama service stopped.";
      }

      // Linux stop
      try {
        await execShell("systemctl stop ollama");
      } catch {}
      await execShell("pkill ollama");
      return "✅ Ollama service stopped.";
    }
  }

  throw new Error(`Unsupported service control for: "${serviceName}"`);
}

/**
 * Adjusts system settings like output volume or screen brightness (Cross-Platform).
 */
export async function adjustSystemSetting(setting: "volume" | "brightness", value: number): Promise<string> {
  const pct = Math.max(0, Math.min(100, value));
  const platform = getPlatform();

  if (setting === "volume") {
    if (platform === "darwin") {
      await execAppleScript(`set volume output volume ${pct}`);
      return `✅ System volume adjusted to: ${pct}%`;
    }

    if (platform === "win32") {
      // Resets volume to 0 first, then increments up to target percentage using ComObject WScript.Shell key strokes
      // Interval is 2% volume per keystroke, so dividing percentage by 2 matches volume precisely
      const clicks = Math.round(pct / 2);
      const cmd = `
        $wsh = New-Object -ComObject WScript.Shell;
        for ($i = 0; $i -lt 50; $i++) { $wsh.SendKeys([char]174) };
        for ($i = 0; $i -lt ${clicks}; $i++) { $wsh.SendKeys([char]175) };
      `;
      await execPowerShell(cmd);
      return `✅ System volume adjusted to: ${pct}%`;
    }

    // Linux volume
    try {
      // Try PipeWire / PulseAudio first
      await execShell(`pactl set-sink-volume @DEFAULT_SINK@ ${pct}%`);
      return `✅ System volume adjusted to: ${pct}%`;
    } catch {
      // Fallback to ALSA
      await execShell(`amixer set Master ${pct}%`);
      return `✅ System volume adjusted (via ALSA) to: ${pct}%`;
    }
  }

  if (setting === "brightness") {
    if (platform === "darwin") {
      try {
        const script = `
          tell application "System Events"
            repeat with disp in displays
              set brightness of disp to ${pct / 100.0}
            end repeat
          end tell
        `;
        await execAppleScript(script);
        return `✅ Display brightness adjusted to: ${pct}%`;
      } catch {
        await execShell(`brightness ${pct / 100.0}`);
        return `✅ Display brightness adjusted to: ${pct}%`;
      }
    }

    if (platform === "win32") {
      const cmd = `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${pct})`;
      await execPowerShell(cmd);
      return `✅ Display brightness adjusted to: ${pct}%`;
    }

    // Linux brightness
    try {
      await execShell(`brightnessctl set ${pct}%`);
      return `✅ Display brightness adjusted to: ${pct}%`;
    } catch {
      await execShell(`xbacklight -set ${pct}`);
      return `✅ Display brightness adjusted (via xbacklight) to: ${pct}%`;
    }
  }

  throw new Error(`Unsupported system setting adjustment: "${setting}"`);
}

/**
 * Reads or writes dynamically to the System Clipboard (Cross-Platform).
 */
export async function handleClipboard(action: "read" | "write", text?: string): Promise<string> {
  const platform = getPlatform();

  if (action === "read") {
    if (platform === "darwin") {
      return await execAppleScript("the clipboard");
    }
    if (platform === "win32") {
      return await execPowerShell("Get-Clipboard");
    }
    // Linux clipboard read (xclip / xsel fallback)
    try {
      return await execShell("xclip -o -selection clipboard");
    } catch {
      return await execShell("xsel -o -b");
    }
  }

  if (action === "write") {
    if (text === undefined) {
      throw new Error("Missing 'text' parameter for clipboard write action.");
    }
    if (platform === "darwin") {
      const cleanText = text.replace(/"/g, '\\"');
      await execAppleScript(`set the clipboard to "${cleanText}"`);
      return `✅ Text successfully copied to system clipboard: "${text.slice(0, 50)}..."`;
    }

    if (platform === "win32") {
      const cleanText = text.replace(/`/g, "``").replace(/"/g, '`"');
      await execPowerShell(`Set-Clipboard -Value "${cleanText}"`);
      return `✅ Text successfully copied to system clipboard: "${text.slice(0, 50)}..."`;
    }

    // Linux clipboard write
    const cleanText = text.replace(/"/g, '\\"');
    try {
      await execShell(`echo -n "${cleanText}" | xclip -selection clipboard`);
    } catch {
      try {
        await execShell(`echo -n "${cleanText}" | xsel -b`);
      } catch {
        await execShell(`echo -n "${cleanText}" | wl-copy`);
      }
    }
    return `✅ Text successfully copied to system clipboard: "${text.slice(0, 50)}..."`;
  }

  throw new Error(`Unsupported clipboard action: "${action}"`);
}
