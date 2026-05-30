// tests/app-control.test.ts
// Cross-platform automated tests for macOS, Windows, and Linux full-device automation routing

import { expect, test, describe, mock } from "bun:test";
import { webSearchTool } from "../tools/web-search.js";
import { resolveLatestVideo } from "../tools/apps/youtube.ts";
import { appControlTool } from "../tools/apps/index.ts";
import type { ToolContext } from "../modes/agent/types.js";

// Global tracking variables for mocked command executions
let executedScript = "";
let executedPowerShell = "";
let executedShell = "";
let mockedPlatform: "darwin" | "win32" | "linux" = "darwin";

// Native Bun module mock for platform-specific utilities
mock.module("../tools/apps/utils.js", () => {
  return {
    getPlatform: () => mockedPlatform,
    execAppleScript: async (script: string) => {
      executedScript = script;
      return "Google Chrome |-| https://google.com";
    },
    execPowerShell: async (command: string) => {
      executedPowerShell = command;
      return "true\nGoogle Chrome |-| https://google.com";
    },
    execShell: async (command: string) => {
      executedShell = command;
      return "true";
    },
    isAppRunning: async () => true,
    activateApp: async () => {},
  };
});

const originalSearchExecute = webSearchTool.execute;

describe("Cross-Platform App-Control Subsystem", () => {
  const mockContext: ToolContext = {
    userId: "test-user-id",
    channel: "cli",
    requestConsent: async () => true,
    workspacePath: process.cwd(),
  };

  test("resolveLatestVideo correctly finds youtube watch URL from search", async () => {
    webSearchTool.execute = async () => [
      { title: "Google Main Page", url: "https://google.com", snippet: "Google search engine" },
      { title: "Madhu's Latest Video — Masterclass React", url: "https://www.youtube.com/watch?v=mockVideo123", snippet: "Check out this amazing tutorial!" },
      { title: "Other Link", url: "https://example.com", snippet: "plain site" }
    ];

    const result = await resolveLatestVideo("Madhu", mockContext);
    expect(result.title).toBe("Madhu's Latest Video — Masterclass React");
    expect(result.url).toBe("https://www.youtube.com/watch?v=mockVideo123");

    webSearchTool.execute = originalSearchExecute;
  });

  test("appControlTool validates missing parameters robustly", async () => {
    expect(appControlTool.execute({ app: "chrome" }, mockContext)).rejects.toThrow("Missing 'action' parameter");
    expect(appControlTool.execute({ action: "open_url" }, mockContext)).rejects.toThrow("Missing 'app' parameter");
  });

  // ====== 1. macOS (darwin) Verification ======
  test("darwin executes native AppleScript commands correctly", async () => {
    mockedPlatform = "darwin";
    executedScript = "";

    const volumeResult = await appControlTool.execute({
      app: "system",
      action: "volume",
      value: 80
    }, mockContext);
    expect(volumeResult).toContain("adjusted to: 80%");
    expect(executedScript).toBe("set volume output volume 80");

    const vscodeResult = await appControlTool.execute({
      app: "system",
      action: "vscode",
      folder: "~/Desktop/Dev"
    }, mockContext);
    expect(vscodeResult).toContain("Launched Visual Studio Code");
    expect(executedScript).toContain('tell application "Visual Studio Code"');
  });

  // ====== 2. Windows (win32) Verification ======
  test("win32 executes native PowerShell commands correctly", async () => {
    mockedPlatform = "win32";
    executedPowerShell = "";

    // Test volume increment loop
    const volumeResult = await appControlTool.execute({
      app: "system",
      action: "volume",
      value: 50
    }, mockContext);
    expect(volumeResult).toContain("volume adjusted to: 50%");
    expect(executedPowerShell).toContain("SendKeys");
    expect(executedPowerShell).toContain("175"); // Volume Up clicker token

    // Test brightness control cmdlet
    const brightnessResult = await appControlTool.execute({
      app: "system",
      action: "brightness",
      value: 60
    }, mockContext);
    expect(brightnessResult).toContain("brightness adjusted to: 60%");
    expect(executedPowerShell).toContain("WmiMonitorBrightnessMethods");
    expect(executedPowerShell).toContain("60");

    // Test clipboard copier
    const clipboardResult = await appControlTool.execute({
      app: "system",
      action: "clipboard",
      subAction: "write",
      text: "PowerShell text"
    }, mockContext);
    expect(clipboardResult).toContain("successfully copied");
    expect(executedPowerShell).toContain("Set-Clipboard");

    // Test keyboard type simulation
    const typeResult = await appControlTool.execute({
      app: "keyboard",
      action: "type",
      text: "hello win!"
    }, mockContext);
    expect(typeResult).toContain("Typed simulated keystroke");
    expect(executedPowerShell).toContain("SendKeys");
  });

  // ====== 3. Linux Verification ======
  test("linux executes native shell utilities correctly", async () => {
    mockedPlatform = "linux";
    executedShell = "";

    // Test ALSA/pactl audio controller
    const volumeResult = await appControlTool.execute({
      app: "system",
      action: "volume",
      value: 70
    }, mockContext);
    expect(volumeResult).toContain("volume adjusted to: 70%");
    expect(executedShell).toContain("pactl set-sink-volume");

    // Test brightnessctl brightness setting
    const brightnessResult = await appControlTool.execute({
      app: "system",
      action: "brightness",
      value: 40
    }, mockContext);
    expect(brightnessResult).toContain("brightness adjusted to: 40%");
    expect(executedShell).toContain("brightnessctl set 40%");

    // Test xdotool keypress simulation
    const pressResult = await appControlTool.execute({
      app: "keyboard",
      action: "press_key",
      key: "enter",
      modifiers: ["ctrl"]
    }, mockContext);
    expect(pressResult).toContain("Pressed simulated key");
    expect(executedShell).toContain('xdotool key "ctrl+Return"');
  });
});
