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
 * Opens a URL in a macOS browser using AppleScript.
 * @param appName The browser application name (e.g., 'Google Chrome', 'Safari')
 * @param url The URL to open
 */
export async function openMacBrowserUrl(appName: string, url: string): Promise<void> {
  const cleanUrl = url.replace(/"/g, '\\"');
  const targetProperty = appName === "Safari" ? "document 1" : "active tab of window 1";
  const script = `
    tell application "${appName}"
      activate
      delay 0.3
      if (count of windows) is 0 then
        make new window
        set URL of ${targetProperty} to "${cleanUrl}"
      else
        tell window 1
          make new tab with properties {URL:"${cleanUrl}"}
        end tell
      end if
    end tell
  `;
  await execAppleScript(script);
}



