// tools/code-exec.ts
// Executes TypeScript/JavaScript in a temp file using BunSandbox with a timeout

import type { ToolDefinition } from "../modes/agent/types.js";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { BunSandbox } from "../sandbox/index.js";

export const codeExecTool: ToolDefinition = {
  name: "code_exec",
  description: "Execute TypeScript/JavaScript code in a sandboxed temp file",
  risky: true,
  readOnly: false,
  execute: async (args, ctx) => {
    const code = args.code as string;
    const timeout = (args.timeout as number) ?? 10_000;
    const workspacePath = ctx.workspacePath;

    // Ensure temp dir exists
    const tmpDir = path.join(workspacePath, ".pandaclaw");
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }

    const tmpFile = path.join(tmpDir, `exec_${Date.now()}.ts`);

    try {
      writeFileSync(tmpFile, code, "utf8");

      const sandbox = new BunSandbox();
      const result = await sandbox.execute(["bun", "run", tmpFile], {
        cwd: workspacePath,
        timeoutMs: timeout,
      });

      if (result.exitCode === 0) {
        return { stdout: result.stdout, exitCode: 0 };
      } else {
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      }
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return {
        stdout: (e.stdout ?? "").trim(),
        stderr: (e.stderr ?? e.message ?? "unknown error").trim(),
        exitCode: 1,
      };
    } finally {
      try {
        if (existsSync(tmpFile)) unlinkSync(tmpFile);
      } catch {
        // Cleanup failure is non-fatal
      }
    }
  },
};

