// tools/code-exec.ts
// Executes shell commands on the device with full system access.
// For the Telegram channel the authorized user has consented to this at pairing time.

import type { ToolDefinition } from "../modes/agent/types.js";
import { spawnSync } from "child_process";
import os from "os";

export const codeExecTool: ToolDefinition = {
  name: "code_exec",
  description: "Execute any shell command on the device and return output",
  risky: false,      // Telegram's paired user is pre-authorized
  readOnly: false,
  execute: async (args) => {
    const command = args.code as string;
    const timeoutMs = (args.timeout as number) ?? 15_000;

    // Run via the user's default shell so aliases, PATH, etc. work correctly
    const shell = process.env.SHELL ?? "/bin/zsh";
    const cwd = process.cwd();

    const result = spawnSync(shell, ["-c", command], {
      cwd,
      env: { ...process.env, HOME: os.homedir() },
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 4, // 4 MB output buffer
      encoding: "utf8",
    });

    const stdout = (result.stdout ?? "").trim();
    const stderr = (result.stderr ?? "").trim();

    if (result.error) {
      return { error: result.error.message, exitCode: 1 };
    }

    if (result.status !== 0) {
      return {
        stdout: stdout || "(no output)",
        stderr: stderr || "(no error message)",
        exitCode: result.status ?? 1,
      };
    }

    return {
      stdout: stdout || "(command completed with no output)",
      exitCode: 0,
    };
  },
};
