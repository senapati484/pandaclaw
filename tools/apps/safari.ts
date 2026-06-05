import { getPlatform, execAppleScript, execPowerShell, execShell, openMacBrowserUrl } from "./utils.js";

/**
 * Open a specific URL in the fallback browser.
 * macOS: Safari
 * Windows: Microsoft Edge (Safari fallback)
 * Linux: Firefox (Safari fallback)
 */
export async function openSafariUrl(url: string): Promise<string> {
  const platform = getPlatform();

  if (platform === "darwin") {
    await openMacBrowserUrl("Safari", url);
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
