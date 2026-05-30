// tools/apps/browser-actions.ts
// Cross-platform browser controls: tab listing, tab switching, and shortcut navigation

import { getPlatform, execAppleScript } from "./utils.js";
import { simulateKeyPress } from "./keyboard.js";

/**
 * Scroll the browser page (Cross-Platform).
 */
export async function scrollBrowser(
  browser: "chrome" | "safari",
  direction: "up" | "down" | "top" | "bottom"
): Promise<string> {
  const platform = getPlatform();

  if (platform === "darwin") {
    const browserName = browser === "chrome" ? "Google Chrome" : "Safari";
    let keyCommand = "";
    switch (direction) {
      case "down": keyCommand = 'key code 121'; break; // Page Down
      case "up": keyCommand = 'key code 116'; break;   // Page Up
      case "top": keyCommand = 'key code 115'; break;  // Home
      case "bottom": keyCommand = 'key code 119'; break; // End
    }
    const script = `
      tell application "${browserName}" to activate
      delay 0.1
      tell application "System Events"
        ${keyCommand}
      end tell
    `;
    await execAppleScript(script);
    return `✅ Scrolled browser (${browserName}) ${direction}`;
  }

  // Windows / Linux: delegates to native keyboard keycode simulations
  let key = "";
  if (platform === "win32") {
    switch (direction) {
      case "down": key = "pgdn"; break;
      case "up": key = "pgup"; break;
      case "top": key = "home"; break;
      case "bottom": key = "end"; break;
    }
    await simulateKeyPress(key);
  } else {
    // Linux xdotool key mapping
    switch (direction) {
      case "down": key = "Page_Down"; break;
      case "up": key = "Page_Up"; break;
      case "top": key = "Home"; break;
      case "bottom": key = "End"; break;
    }
    await simulateKeyPress(key);
  }

  return `✅ Scrolled browser ${direction}`;
}

/**
 * Navigation actions: back, forward, refresh, close_tab (Cross-Platform).
 */
export async function navigateBrowser(
  browser: "chrome" | "safari",
  action: "back" | "forward" | "refresh" | "close_tab"
): Promise<string> {
  const platform = getPlatform();

  if (platform === "darwin") {
    const browserName = browser === "chrome" ? "Google Chrome" : "Safari";
    let shortcutCommand = "";
    switch (action) {
      case "back": shortcutCommand = 'keystroke "[" using command down'; break;
      case "forward": shortcutCommand = 'keystroke "]" using command down'; break;
      case "refresh": shortcutCommand = 'keystroke "r" using command down'; break;
      case "close_tab": shortcutCommand = 'keystroke "w" using command down'; break;
    }
    const script = `
      tell application "${browserName}" to activate
      delay 0.1
      tell application "System Events"
        ${shortcutCommand}
      end tell
    `;
    await execAppleScript(script);
    return `✅ Executed action "${action}" on ${browserName}`;
  }

  // Windows / Linux navigations via standard keyboard shortcut simulator
  if (platform === "win32") {
    switch (action) {
      case "back": await simulateKeyPress("left", ["alt"]); break;
      case "forward": await simulateKeyPress("right", ["alt"]); break;
      case "refresh": await simulateKeyPress("r", ["control"]); break;
      case "close_tab": await simulateKeyPress("w", ["control"]); break;
    }
  } else {
    // Linux mapping
    switch (action) {
      case "back": await simulateKeyPress("Alt+Left"); break;
      case "forward": await simulateKeyPress("Alt+Right"); break;
      case "refresh": await simulateKeyPress("Ctrl+r"); break;
      case "close_tab": await simulateKeyPress("Ctrl+w"); break;
    }
  }

  return `✅ Executed browser navigation: "${action}"`;
}

/**
 * Retrieves a list of active tabs (macOS only, gracefully falls back on Windows/Linux).
 */
export async function listTabs(browser: "chrome" | "safari"): Promise<Array<{ index: number; title: string; url: string }>> {
  const platform = getPlatform();

  if (platform !== "darwin") {
    console.warn(`Tab listing is natively supported on macOS. Gracefully returning empty list.`);
    return [];
  }

  const browserName = browser === "chrome" ? "Google Chrome" : "Safari";
  const titleField = browser === "chrome" ? "title" : "name";

  const script = `
    set tabList to {}
    tell application "${browserName}"
      repeat with w in windows
        repeat with t in tabs of w
          set end of tabList to (${titleField} of t & " |-| " & URL of t)
        end repeat
      end repeat
    end tell
    set AppleScript's text item delimiters to linefeed
    return tabList as string
  `;

  try {
    const rawResult = await execAppleScript(script);
    if (!rawResult) return [];

    const lines = rawResult.split("\n");
    return lines.map((line, i) => {
      const parts = line.split(" |-| ");
      return {
        index: i + 1,
        title: parts[0]?.trim() || "Untitled Tab",
        url: parts[1]?.trim() || "about:blank",
      };
    });
  } catch {
    return [];
  }
}

/**
 * Switches browser focus to a tab matching title/index (macOS only, returns feedback on Win/Linux).
 */
export async function switchToTab(
  browser: "chrome" | "safari",
  target: number | string
): Promise<string> {
  const platform = getPlatform();

  if (platform !== "darwin") {
    return `⚠️ Multi-tab focusing is natively supported on macOS. On Windows/Linux, you can switch tabs using standard shortcut key simulation (e.g. Ctrl + Tab).`;
  }

  const browserName = browser === "chrome" ? "Google Chrome" : "Safari";

  if (typeof target === "number") {
    const index = Math.max(1, target);
    let script = "";
    if (browser === "chrome") {
      script = `
        tell application "Google Chrome"
          if (exists window 1) then
            set tabCount to count of tabs of window 1
            if ${index} <= tabCount then
              set active tab index of window 1 to ${index}
            end if
          end if
          activate
        end tell
      `;
    } else {
      script = `
        tell application "Safari"
          if (exists window 1) then
            set tabCount to count of tabs of window 1
            if ${index} <= tabCount then
              set current tab of window 1 to tab ${index} of window 1
            end if
          end if
          activate
        end tell
      `;
    }
    await execAppleScript(script);
    return `✅ Switched ${browserName} to tab index: ${index}`;
  }

  const query = target.replace(/"/g, '\\"');
  let script = "";
  if (browser === "chrome") {
    script = `
      tell application "Google Chrome"
        set found to false
        repeat with w in windows
          set tabCount to count of tabs of w
          repeat with i from 1 to tabCount
            set t to tab i of w
            if (title of t contains "${query}") or (URL of t contains "${query}") then
              set active tab index of w to i
              set index of w to 1
              set found to true
              exit repeat
            end if
          end repeat
          if found then exit repeat
        end repeat
        activate
      end tell
    `;
  } else {
    script = `
      tell application "Safari"
        set found to false
        repeat with w in windows
          set tabCount to count of tabs of w
          repeat with i from 1 to tabCount
            set t to tab i of w
            if (name of t contains "${query}") or (URL of t contains "${query}") then
              set current tab of w to t
              set index of w to 1
              set found to true
              exit repeat
            end if
          end repeat
          if found then exit repeat
        end repeat
        activate
      end tell
    `;
  }

  await execAppleScript(script);
  return `✅ Focused tab matching query "${target}" in ${browserName}`;
}
