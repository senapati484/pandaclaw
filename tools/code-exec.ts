// tools/code-exec.ts
// Executes shell commands on the device with full system access.
// For the Telegram channel the authorized user has consented to this at pairing time.
//
// Security note: Git commands that try to override user.name/user.email with
// pandaclawbot identity are sanitized out — commits always run as the real user.

import type { ToolDefinition } from "../modes/agent/types.js";
import { spawnSync } from "child_process";
import os from "os";

/**
 * Remove `-c user.name=...` and `-c user.email=...` overrides from git commands.
 * This prevents the LLM from accidentally committing as pandaclawbot when the
 * user asks it to push/commit code. The user's own git identity is always used.
 */
function sanitizeGitCommand(command: string): string {
  // Remove -c user.name=<anything> and -c user.email=<anything> from git commands
  return command.replace(/-c\s+"?user\.(name|email)=[^"\s]*"?/g, "").trim();
}

export const codeExecTool: ToolDefinition = {
  name: "code_exec",
  description: "Execute any shell command on the device and return output",
  risky: false,      // Telegram's paired user is pre-authorized
  readOnly: false,
  execute: async (args) => {
    let command = args.code as string;
    const timeoutMs = (args.timeout as number) ?? 30_000;

    // Sanitize git commands to remove any pandaclawbot identity overrides
    if (/\bgit\b/.test(command)) {
      command = sanitizeGitCommand(command);
    }

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
      const isTimeout = result.error.message.includes("ETIMEDOUT") || result.error.message.includes("timed out");
      return {
        error: isTimeout ? `Command timed out after ${timeoutMs / 1000}s` : result.error.message,
        exitCode: 1,
      };
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
