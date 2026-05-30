// tools/apps/keyboard.ts
// Cross-platform keyboard and shortcut simulations supporting macOS, Windows, and Linux

import { getPlatform, execAppleScript, execPowerShell, execShell } from "./utils.js";

/**
 * Escapes standard characters that have special tokens in Windows SendKeys syntax.
 */
function escapeSendKeys(text: string): string {
  return text.replace(/([+^%~(){}[\]])/g, "{$1}");
}

/**
 * Types a dynamic text string simulating standard user keyboard entries (Cross-Platform).
 */
export async function simulateKeystroke(text: string): Promise<string> {
  const platform = getPlatform();

  if (platform === "darwin") {
    const cleanText = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = `
      tell application "System Events"
        keystroke "${cleanText}"
      end tell
    `;
    await execAppleScript(script);
    return `✅ Typed simulated keystroke: "${text}"`;
  }

  if (platform === "win32") {
    const escaped = escapeSendKeys(text)
      .replace(/`/g, "``")
      .replace(/"/g, '""');
    const cmd = `
      $ws = New-Object -ComObject WScript.Shell;
      $ws.SendKeys("${escaped}");
    `;
    await execPowerShell(cmd);
    return `✅ Typed simulated keystroke: "${text}"`;
  }

  // Linux keyboard simulation via xdotool
  try {
    const cleanText = text.replace(/"/g, '\\"');
    await execShell(`xdotool type "${cleanText}"`);
    return `✅ Typed simulated keystroke: "${text}"`;
  } catch (err: any) {
    throw new Error(`Failed to simulate Linux keystroke (ensure xdotool is installed): ${err.message}`);
  }
}

/**
 * Presses a specific special key or key combo (Cross-Platform).
 */
export async function simulateKeyPress(key: string, modifiers?: string[]): Promise<string> {
  const platform = getPlatform();
  const lowerKey = key.toLowerCase();

  // ====== 1. macOS Darwin Branch ======
  if (platform === "darwin") {
    let modifierString = "";
    if (modifiers && modifiers.length > 0) {
      const mapped = modifiers
        .map((mod) => {
          const lower = mod.toLowerCase();
          if (lower === "command" || lower === "cmd") return "command down";
          if (lower === "option" || lower === "alt") return "option down";
          if (lower === "control" || lower === "ctrl") return "control down";
          if (lower === "shift") return "shift down";
          return null;
        })
        .filter((m): m is Exclude<typeof m, null> => m !== null);
      if (mapped.length > 0) {
        modifierString = ` using {${mapped.join(", ")}}`;
      }
    }

    let pressCommand = "";
    if (lowerKey === "return" || lowerKey === "enter") pressCommand = "key code 36";
    else if (lowerKey === "tab") pressCommand = "key code 48";
    else if (lowerKey === "space") pressCommand = "key code 49";
    else if (lowerKey === "escape" || lowerKey === "esc") pressCommand = "key code 53";
    else if (lowerKey === "up") pressCommand = "key code 126";
    else if (lowerKey === "down") pressCommand = "key code 125";
    else if (lowerKey === "left") pressCommand = "key code 123";
    else if (lowerKey === "right") pressCommand = "key code 124";
    else if (lowerKey === "pgdn") pressCommand = "key code 121";
    else if (lowerKey === "pgup") pressCommand = "key code 116";
    else if (lowerKey === "home") pressCommand = "key code 115";
    else if (lowerKey === "end") pressCommand = "key code 119";
    else {
      const escapedChar = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      pressCommand = `keystroke "${escapedChar}"`;
    }

    const script = `
      tell application "System Events"
        ${pressCommand}${modifierString}
      end tell
    `;
    await execAppleScript(script);
    return `✅ Pressed simulated key: "${key}"`;
  }

  // ====== 2. Windows win32 Branch (SendKeys) ======
  if (platform === "win32") {
    let sendKeysToken = "";
    if (lowerKey === "return" || lowerKey === "enter") sendKeysToken = "{ENTER}";
    else if (lowerKey === "tab") sendKeysToken = "{TAB}";
    else if (lowerKey === "space") sendKeysToken = " ";
    else if (lowerKey === "escape" || lowerKey === "esc") sendKeysToken = "{ESC}";
    else if (lowerKey === "up") sendKeysToken = "{UP}";
    else if (lowerKey === "down") sendKeysToken = "{DOWN}";
    else if (lowerKey === "left") sendKeysToken = "{LEFT}";
    else if (lowerKey === "right") sendKeysToken = "{RIGHT}";
    else if (lowerKey === "pgdn") sendKeysToken = "{PGDN}";
    else if (lowerKey === "pgup") sendKeysToken = "{PGUP}";
    else if (lowerKey === "home") sendKeysToken = "{HOME}";
    else if (lowerKey === "end") sendKeysToken = "{END}";
    else {
      sendKeysToken = escapeSendKeys(key);
    }

    let modifierPrefix = "";
    if (modifiers && modifiers.length > 0) {
      for (const m of modifiers) {
        const lower = m.toLowerCase();
        if (lower === "control" || lower === "ctrl") modifierPrefix += "^";
        if (lower === "alt" || lower === "option") modifierPrefix += "%";
        if (lower === "shift") modifierPrefix += "+";
      }
    }

    const cmd = `
      $ws = New-Object -ComObject WScript.Shell;
      $ws.SendKeys("${modifierPrefix}${sendKeysToken}");
    `;
    await execPowerShell(cmd);
    return `✅ Pressed simulated key: "${key}"`;
  }

  // ====== 3. Linux Linux Branch (xdotool) ======
  try {
    let modifierPrefix = "";
    if (modifiers && modifiers.length > 0) {
      modifierPrefix = modifiers
        .map((mod) => {
          const lower = mod.toLowerCase();
          if (lower === "command" || lower === "cmd") return "super";
          if (lower === "control" || lower === "ctrl") return "ctrl";
          if (lower === "alt" || lower === "option") return "alt";
          if (lower === "shift") return "shift";
          return null;
        })
        .filter((m): m is Exclude<typeof m, null> => m !== null)
        .join("+") + "+";
    }

    let linuxKey = key;
    if (lowerKey === "return" || lowerKey === "enter") linuxKey = "Return";
    else if (lowerKey === "tab") linuxKey = "Tab";
    else if (lowerKey === "space") linuxKey = "space";
    else if (lowerKey === "escape" || lowerKey === "esc") linuxKey = "Escape";
    else if (lowerKey === "up") linuxKey = "Up";
    else if (lowerKey === "down") linuxKey = "Down";
    else if (lowerKey === "left") linuxKey = "Left";
    else if (lowerKey === "right") linuxKey = "Right";
    else if (lowerKey === "pgdn") linuxKey = "Page_Down";
    else if (lowerKey === "pgup") linuxKey = "Page_Up";
    else if (lowerKey === "home") linuxKey = "Home";
    else if (lowerKey === "end") linuxKey = "End";

    await execShell(`xdotool key "${modifierPrefix}${linuxKey}"`);
    return `✅ Pressed simulated key: "${key}"`;
  } catch (err: any) {
    throw new Error(`Failed to simulate Linux keypress (ensure xdotool is installed): ${err.message}`);
  }
}
