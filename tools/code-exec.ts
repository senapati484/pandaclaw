// tools/code-exec.ts
// Executes shell commands on the device with full system access.
// For the Telegram channel the authorized user has consented to this at pairing time.
//
// Security note: Git commands that try to override user.name/user.email with
// pandaclawbot identity are sanitized out — commits always run as the real user.

import type { ToolDefinition } from "../modes/agent/types.js";
import { spawnSync } from "child_process";
import * as os from "os";

/**
 * Remove `-c user.name=...` and `-c user.email=...` overrides from git commands.
 * This prevents the LLM from accidentally committing as pandaclawbot when the
 * user asks it to push/commit code. The user's own git identity is always used.
 */
function sanitizeGitCommand(command: string): string {
  return command.replace(/-c\s+"?user\.(name|email)=[^"\s]*"?/g, "").trim();
}

interface HintMatcher {
  match: (combined: string, stdout: string, stderr: string, command: string) => boolean;
  getHint: (combined: string, stdout: string, stderr: string, command: string) => string;
}

const HINT_MATCHERS: HintMatcher[] = [
  {
    match: (combined) => combined.includes("eoferror") || combined.includes("eof when reading"),
    getHint: () =>
      "The script called input() / readline but stdin is not interactive inside code_exec. " +
      "Fix: add a non-interactive fallback — check sys.stdin.isatty() (Python) or process.stdin.isTTY (Node), " +
      "catch EOFError, or supply inputs via command-line arguments or a pipe (e.g. echo '5' | python3 script.py)."
  },
  {
    match: (combined) =>
      combined.includes("modulenotfounderror") ||
      combined.includes("no module named") ||
      combined.includes("importerror"),
    getHint: (combined, stdout, stderr) => {
      const match =
        stderr.match(/no module named ['"]?([\w.-]+)['"]?/i) ||
        stdout.match(/no module named ['"]?([\w.-]+)['"]?/i);
      const pkg = match?.[1] ?? "<package>";
      return (
        `Missing Python package '${pkg}'. Install it first: run code_exec with ` +
        `command "pip3 install ${pkg}" or "pip3 install ${pkg} --user", then retry.`
      );
    }
  },
  {
    match: (combined) => combined.includes("cannot find module") || combined.includes("err_module_not_found"),
    getHint: (combined, stdout, stderr) => {
      const match =
        stderr.match(/cannot find module ['"]([^'"]+)['"]/i) ||
        stdout.match(/cannot find module ['"]([^'"]+)['"]/i);
      const pkg = match?.[1] ?? "<package>";
      return (
        `Missing Node/Bun module '${pkg}'. Install it first: run code_exec with ` +
        `command "bun add ${pkg}" or "npm install ${pkg}", then retry.`
      );
    }
  },
  {
    match: (combined) => combined.includes("permission denied"),
    getHint: () =>
      "Permission denied. If this is a script file, make it executable first: " +
      "run code_exec with 'chmod +x <path>' then retry. " +
      "If it's a directory or system path, check that the path is correct."
  },
  {
    match: (combined) =>
      combined.includes("command not found") ||
      (combined.includes("not found") && combined.includes("zsh:")),
    getHint: (combined, stdout, stderr, command) => {
      const match = command.match(/^(\S+)/);
      const cmd = match?.[1] ?? "the command";
      return (
        `'${cmd}' was not found on PATH. Check if it's installed (e.g. 'which ${cmd}' or 'brew install ${cmd}'). ` +
        "If writing a script, ensure you use the correct interpreter path (e.g. /usr/bin/env python3)."
      );
    }
  },
  {
    match: (combined) => combined.includes("syntaxerror") || combined.includes("invalid syntax"),
    getHint: () =>
      "Python SyntaxError detected. Re-read the written file with file_read, find and fix the syntax error, rewrite the file, and re-run."
  },
  {
    match: (combined) => combined.includes("indentationerror") || combined.includes("unexpected indent"),
    getHint: () =>
      "Python IndentationError. Re-read the written file, fix the indentation, rewrite it, and re-run."
  },
  {
    match: (combined) => combined.includes("no such file or directory") || combined.includes("filenotfounderror"),
    getHint: () =>
      "A file or directory referenced in the command does not exist. " +
      "Verify the path with list_dir or file_read, then retry with the correct absolute path."
  },
  {
    match: (combined) => combined.includes("etimedout") || combined.includes("timed out"),
    getHint: () =>
      "The command timed out. If it's a long-running process, increase the timeout parameter. " +
      "If it's an interactive script waiting for stdin, add a non-interactive fallback."
  },
  {
    match: (combined) => combined.includes("typeerror") && (combined.includes("bun") || combined.includes("typescript")),
    getHint: () =>
      "TypeScript/Bun type error. Re-read the file, fix the type error, rewrite, and re-run."
  }
];

function detectHint(stdout: string, stderr: string, command: string): string | null {
  const combined = `${stdout}\n${stderr}`.toLowerCase();

  for (const matcher of HINT_MATCHERS) {
    if (matcher.match(combined, stdout, stderr, command)) {
      return matcher.getHint(combined, stdout, stderr, command);
    }
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

interface ExecResult {
  stdout: string;
  stderr?: string;
  exitCode: number;
  hint?: string;
}

function handleSpawnError(error: Error, timeoutMs: number, command: string): ExecResult {
  const isTimeout = error.message.includes("ETIMEDOUT") || error.message.includes("timed out");
  const errMsg = isTimeout ? `Command timed out after ${timeoutMs / 1000}s` : error.message;
  const hint = detectHint("", errMsg, command);
  return {
    stdout: "(no output — command failed to start)",
    stderr: errMsg,
    exitCode: 1,
    ...(hint ? { hint } : {}),
  };
}

function handleNonZeroExit(status: number | null, stdout: string, stderr: string, command: string): ExecResult {
  const hint = detectHint(stdout, stderr, command);
  return {
    stdout: stdout || "(no stdout)",
    stderr: stderr || "(no stderr)",
    exitCode: status ?? 1,
    ...(hint ? { hint } : {}),
  };
}

export const codeExecTool: ToolDefinition = {
  name: "code_exec",
  description:
    "Execute any shell command on the device and return output. " +
    "Always includes exitCode. On failure also includes an actionable 'hint' field explaining how to fix the error.",
  riskLevel: "ask",
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

    if (result.error) {
      return handleSpawnError(result.error, timeoutMs, command);
    }

    const stdout = (result.stdout ?? "").trim();
    const stderr = (result.stderr ?? "").trim();

    if (result.status !== 0) {
      return handleNonZeroExit(result.status, stdout, stderr, command);
    }

    // Success
    return {
      stdout: stdout || "(command completed with no output)",
      exitCode: 0,
    };
  },
};
