// tools/apps/chrome.ts
// Google Chrome controller supporting macOS, Windows, and Linux

import { getPlatform, execAppleScript, execPowerShell, execShell } from "./utils.js";

/**
 * Open a specific URL in Google Chrome (Cross-Platform).
 * On macOS: Runs custom tab AppleScripts.
 * On Windows/Linux: Launches chrome CLI with URL, falling back to system default.
 */
export async function openChromeUrl(url: string): Promise<string> {
  const platform = getPlatform();

  if (platform === "darwin") {
    const cleanUrl = url.replace(/"/g, '\\"');
    const script = `
      tell application "Google Chrome"
        activate
        delay 0.3
        if (count of windows) is 0 then
          make new window
          set URL of active tab of window 1 to "${cleanUrl}"
        else
          tell window 1
            make new tab with properties {URL:"${cleanUrl}"}
          end tell
        end if
      end tell
    `;
    await execAppleScript(script);
    return `✅ Opened URL in Google Chrome: ${url}`;
  }

  if (platform === "win32") {
    try {
      await execPowerShell(`Start-Process "chrome" -ArgumentList "${url}"`);
    } catch {
      // Fallback: system default browser
      await execPowerShell(`Start-Process "${url}"`);
    }
    return `✅ Opened URL in Google Chrome: ${url}`;
  }

  // Linux launch
  try {
    await execShell(`google-chrome "${url}" &`);
  } catch {
    try {
      await execShell(`chrome "${url}" &`);
    } catch {
      await execShell(`xdg-open "${url}" &`);
    }
  }
  return `✅ Opened URL in Google Chrome: ${url}`;
}

/**
 * Executes a search query directly inside Google Chrome by opening a Google Search tab.
 */
export async function searchChrome(query: string): Promise<string> {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  await openChromeUrl(searchUrl);
  return `✅ Searched Chrome for: "${query}"`;
}
