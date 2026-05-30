// tools/apps/safari.ts
// Fallback browser launcher supporting macOS, Windows, and Linux

import { getPlatform, execAppleScript, execPowerShell, execShell } from "./utils.js";

/**
 * Open a specific URL in the fallback browser.
 * macOS: Safari
 * Windows: Microsoft Edge (Safari fallback)
 * Linux: Firefox (Safari fallback)
 */
export async function openSafariUrl(url: string): Promise<string> {
  const platform = getPlatform();

  if (platform === "darwin") {
    const cleanUrl = url.replace(/"/g, '\\"');
    const script = `
      tell application "Safari"
        activate
        delay 0.3
        if (count of windows) is 0 then
          make new window
          set URL of document 1 to "${cleanUrl}"
        else
          tell window 1
            make new tab with properties {URL:"${cleanUrl}"}
          end tell
        end if
      end tell
    `;
    await execAppleScript(script);
    return `✅ Opened URL in Safari: ${url}`;
  }

  if (platform === "win32") {
    try {
      await execPowerShell(`Start-Process "msedge" -ArgumentList "${url}"`);
      return `✅ Safari not present on Windows. Opened URL in Microsoft Edge: ${url}`;
    } catch {
      await execPowerShell(`Start-Process "${url}"`);
      return `✅ Safari not present. Opened URL in default Windows browser: ${url}`;
    }
  }

  // Linux launch: maps to Firefox fallback
  try {
    await execShell(`firefox "${url}" &`);
    return `✅ Safari not present on Linux. Opened URL in Firefox: ${url}`;
  } catch {
    await execShell(`xdg-open "${url}" &`);
    return `✅ Safari not present. Opened URL in default Linux browser: ${url}`;
  }
}
