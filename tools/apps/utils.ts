// tools/apps/utils.ts
// Cross-platform process and execution utilities supporting macOS, Windows, and Linux

import os from "os";
import { exec, spawn } from "child_process";

/**
 * Returns the current operating system platform: 'darwin', 'win32', or 'linux'.
 */
export function getPlatform(): "darwin" | "win32" | "linux" {
  const platform = os.platform();
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "win32";
  return "linux"; // Fallback to linux/unix-like
}

/**
 * Execute an AppleScript multiline command securely using child_process spawn (macOS).
 */
export function execAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-e", script]);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const errorMsg = stderr.trim() || `AppleScript exited with code ${code}`;
        reject(new Error(errorMsg));
      }
    });
  });
}

/**
 * Executes a Windows PowerShell command securely using child_process spawn (Windows).
 */
export function execPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", command]);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const errorMsg = stderr.trim() || `PowerShell exited with code ${code}`;
        reject(new Error(errorMsg));
      }
    });
  });
}

/**
 * Executes a standard shell command dynamically (Linux / macOS).
 */
export function execShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Checks if a target application or process is currently running on the device.
 */
export async function isAppRunning(appName: string): Promise<boolean> {
  const platform = getPlatform();

  try {
    if (platform === "darwin") {
      const script = `tell application "System Events" to (name of processes) contains "${appName}"`;
      const result = await execAppleScript(script);
      return result.toLowerCase() === "true";
    }

    if (platform === "win32") {
      const cmd = `Get-Process -Name "${appName}" -ErrorAction SilentlyContinue`;
      const result = await execPowerShell(cmd);
      return result.length > 0;
    }

    // Linux fallback
    const result = await execShell(`pgrep -f "${appName}"`);
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Activates or launches a target application by name.
 */
export async function activateApp(appName: string): Promise<void> {
  const platform = getPlatform();

  if (platform === "darwin") {
    await execAppleScript(`tell application "${appName}" to activate`);
  } else if (platform === "win32") {
    // Launch app via PowerShell Start-Process or shell activation
    await execPowerShell(`Start-Process "${appName}"`);
  } else {
    // Linux launch
    await execShell(`${appName} &`);
  }
}
