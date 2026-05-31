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
  return command.replace(/-c\s+"?user\.(name|email)=[^"\s]*"?/g, "").trim();
}

/**
 * Analyse stdout+stderr from a failed execution and return an actionable hint
 * the LLM can act on immediately without asking the user for help.
 */
function detectHint(stdout: string, stderr: string, command: string): string | null {
  const combined = `${stdout}\n${stderr}`.toLowerCase();

  // Interactive stdin crashed
  if (combined.includes("eoferror") || combined.includes("eof when reading")) {
    return (
      "The script called input() / readline but stdin is not interactive inside code_exec. " +
      "Fix: add a non-interactive fallback — check sys.stdin.isatty() (Python) or process.stdin.isTTY (Node), " +
      "catch EOFError, or supply inputs via command-line arguments or a pipe (e.g. echo '5' | python3 script.py)."
    );
  }

  // Missing Python package
  if (
    combined.includes("modulenotfounderror") ||
    combined.includes("no module named") ||
    combined.includes("importerror")
  ) {
    const match =
      stderr.match(/no module named ['"]?([\w.-]+)['"]?/i) ||
      stdout.match(/no module named ['"]?([\w.-]+)['"]?/i);
    const pkg = match?.[1] ?? "<package>";
    return (
      `Missing Python package '${pkg}'. Install it first: run code_exec with ` +
      `command "pip3 install ${pkg}" or "pip3 install ${pkg} --user", then retry.`
    );
  }

  // Missing Node/Bun package
  if (combined.includes("cannot find module") || combined.includes("err_module_not_found")) {
    const match =
      stderr.match(/cannot find module ['"]([^'"]+)['"]/i) ||
      stdout.match(/cannot find module ['"]([^'"]+)['"]/i);
    const pkg = match?.[1] ?? "<package>";
    return (
      `Missing Node/Bun module '${pkg}'. Install it first: run code_exec with ` +
      `command "bun add ${pkg}" or "npm install ${pkg}", then retry.`
    );
  }

  // Permission denied
  if (combined.includes("permission denied")) {
    return (
      "Permission denied. If this is a script file, make it executable first: " +
      "run code_exec with 'chmod +x <path>' then retry. " +
      "If it's a directory or system path, check that the path is correct."
    );
  }

  // Command not found
  if (
    combined.includes("command not found") ||
    (combined.includes("not found") && combined.includes("zsh:"))
  ) {
    const match = command.match(/^(\S+)/);
    const cmd = match?.[1] ?? "the command";
    return (
      `'${cmd}' was not found on PATH. Check if it's installed (e.g. 'which ${cmd}' or 'brew install ${cmd}'). ` +
      "If writing a script, ensure you use the correct interpreter path (e.g. /usr/bin/env python3)."
    );
  }

  // Python syntax error
  if (combined.includes("syntaxerror") || combined.includes("invalid syntax")) {
    return "Python SyntaxError detected. Re-read the written file with file_read, find and fix the syntax error, rewrite the file, and re-run.";
  }

  // Indentation error
  if (combined.includes("indentationerror") || combined.includes("unexpected indent")) {
    return "Python IndentationError. Re-read the written file, fix the indentation, rewrite it, and re-run.";
  }

  // File not found / no such file
  if (combined.includes("no such file or directory") || combined.includes("filenotfounderror")) {
    return (
      "A file or directory referenced in the command does not exist. " +
      "Verify the path with list_dir or file_read, then retry with the correct absolute path."
    );
  }

  // Timeout
  if (combined.includes("etimedout") || combined.includes("timed out")) {
    return (
      "The command timed out. If it's a long-running process, increase the timeout parameter. " +
      "If it's an interactive script waiting for stdin, add a non-interactive fallback."
    );
  }

  // TypeScript / Bun type error
  if (combined.includes("typeerror") && (combined.includes("bun") || combined.includes("typescript"))) {
    return "TypeScript/Bun type error. Re-read the file, fix the type error, rewrite, and re-run.";
  }

  // Generic non-zero exit with no output at all
  if (!stdout.trim() && !stderr.trim()) {
    return (
      "The command exited with a non-zero code but produced no output. " +
      "Try running with verbose/debug flags, or add error handling to the script to surface the real error."
    );
  }

  return null;
}

export const codeExecTool: ToolDefinition = {
  name: "code_exec",
  description:
    "Execute any shell command on the device and return output. " +
    "Always includes exitCode. On failure also includes an actionable 'hint' field explaining how to fix the error.",
  risky: false,   // Telegram's paired user is pre-authorized
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

    // Timeout / spawn error
    if (result.error) {
      const isTimeout =
        result.error.message.includes("ETIMEDOUT") ||
        result.error.message.includes("timed out");
      const errMsg = isTimeout
        ? `Command timed out after ${timeoutMs / 1000}s`
        : result.error.message;
      const hint = detectHint("", errMsg, command);
      return {
        stdout: "(no output — command failed to start)",
        stderr: errMsg,
        exitCode: 1,
        ...(hint ? { hint } : {}),
      };
    }

    // Non-zero exit
    if (result.status !== 0) {
      const hint = detectHint(stdout, stderr, command);
      return {
        stdout: stdout || "(no stdout)",
        stderr: stderr || "(no stderr)",
        exitCode: result.status ?? 1,
        ...(hint ? { hint } : {}),
      };
    }

    // Success
    return {
      stdout: stdout || "(command completed with no output)",
      exitCode: 0,
    };
  },
};
