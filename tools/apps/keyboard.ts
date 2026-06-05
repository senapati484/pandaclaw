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

const DARWIN_MODIFIERS: Record<string, string> = {
  command: "command down",
  cmd: "command down",
  option: "option down",
  alt: "option down",
  control: "control down",
  ctrl: "control down",
  shift: "shift down"
};

const LINUX_MODIFIERS: Record<string, string> = {
  command: "super",
  cmd: "super",
  control: "ctrl",
  ctrl: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift"
};

const DARWIN_KEY_CODES: Record<string, string> = {
  return: "key code 36",
  enter: "key code 36",
  tab: "key code 48",
  space: "key code 49",
  escape: "key code 53",
  esc: "key code 53",
  up: "key code 126",
  down: "key code 125",
  left: "key code 123",
  right: "key code 124",
  pgdn: "key code 121",
  pgup: "key code 116",
  home: "key code 115",
  end: "key code 119",
};

const WIN32_SEND_KEYS: Record<string, string> = {
  return: "{ENTER}",
  enter: "{ENTER}",
  tab: "{TAB}",
  space: " ",
  escape: "{ESC}",
  esc: "{ESC}",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  pgdn: "{PGDN}",
  pgup: "{PGUP}",
  home: "{HOME}",
  end: "{END}",
};

const LINUX_KEYS: Record<string, string> = {
  return: "Return",
  enter: "Return",
  tab: "Tab",
  space: "space",
  escape: "Escape",
  esc: "Escape",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  pgdn: "Page_Down",
  pgup: "Page_Up",
  home: "Home",
  end: "End",
};

function getDarwinModifierString(modifiers?: string[]): string {
  if (!modifiers || modifiers.length === 0) return "";
  const mapped = modifiers
    .map((mod) => DARWIN_MODIFIERS[mod.toLowerCase()] || null)
    .filter((m): m is string => m !== null);
  if (mapped.length > 0) {
    return ` using {${mapped.join(", ")}}`;
  }
  return "";
}

function getDarwinKeyCodeCommand(lowerKey: string, key: string): string {
  const code = DARWIN_KEY_CODES[lowerKey];
  if (code) return code;
  const escapedChar = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `keystroke "${escapedChar}"`;
}

async function simulateKeyPressDarwin(key: string, modifiers?: string[]): Promise<string> {
  const lowerKey = key.toLowerCase();
  const modifierString = getDarwinModifierString(modifiers);
  const pressCommand = getDarwinKeyCodeCommand(lowerKey, key);

  const script = `
    tell application "System Events"
      ${pressCommand}${modifierString}
    end tell
  `;
  await execAppleScript(script);
  return `✅ Pressed simulated key: "${key}"`;
}

function getWin32SendKeysToken(lowerKey: string, key: string): string {
  const token = WIN32_SEND_KEYS[lowerKey];
  if (token !== undefined) return token;
  return escapeSendKeys(key);
}

function getWin32ModifierPrefix(modifiers?: string[]): string {
  let prefix = "";
  if (modifiers && modifiers.length > 0) {
    for (const m of modifiers) {
      const lower = m.toLowerCase();
      if (lower === "control" || lower === "ctrl") prefix += "^";
      if (lower === "alt" || lower === "option") prefix += "%";
      if (lower === "shift") prefix += "+";
    }
  }
  return prefix;
}

async function simulateKeyPressWin32(key: string, modifiers?: string[]): Promise<string> {
  const lowerKey = key.toLowerCase();
  const sendKeysToken = getWin32SendKeysToken(lowerKey, key);
  const modifierPrefix = getWin32ModifierPrefix(modifiers);

  const cmd = `
    $ws = New-Object -ComObject WScript.Shell;
    $ws.SendKeys("${modifierPrefix}${sendKeysToken}");
  `;
  await execPowerShell(cmd);
  return `✅ Pressed simulated key: "${key}"`;
}

function getLinuxModifierPrefix(modifiers?: string[]): string {
  if (!modifiers || modifiers.length === 0) return "";
  const mapped = modifiers
    .map((mod) => LINUX_MODIFIERS[mod.toLowerCase()] || null)
    .filter((m): m is string => m !== null);
  if (mapped.length > 0) {
    return mapped.join("+") + "+";
  }
  return "";
}

function getLinuxKey(lowerKey: string, key: string): string {
  const lKey = LINUX_KEYS[lowerKey];
  if (lKey) return lKey;
  return key;
}

async function simulateKeyPressLinux(key: string, modifiers?: string[]): Promise<string> {
  const lowerKey = key.toLowerCase();
  const modifierPrefix = getLinuxModifierPrefix(modifiers);
  const linuxKey = getLinuxKey(lowerKey, key);

  try {
    await execShell(`xdotool key "${modifierPrefix}${linuxKey}"`);
    return `✅ Pressed simulated key: "${key}"`;
  } catch (err: any) {
    throw new Error(`Failed to simulate Linux keypress (ensure xdotool is installed): ${err.message}`);
  }
}

/**
 * Presses a specific special key or key combo (Cross-Platform).
 */
export async function simulateKeyPress(key: string, modifiers?: string[]): Promise<string> {
  const platform = getPlatform();

  if (platform === "darwin") {
    return await simulateKeyPressDarwin(key, modifiers);
  }
  if (platform === "win32") {
    return await simulateKeyPressWin32(key, modifiers);
  }
  return await simulateKeyPressLinux(key, modifiers);
}
