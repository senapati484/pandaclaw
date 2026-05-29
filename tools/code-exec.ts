// tools/code-exec.ts
// Executes TypeScript/JavaScript in a temp file using Bun with a timeout

import type { ToolDefinition } from "../modes/agent/types.js";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import path from "path";

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

      const stdout = execSync(`bun run ${tmpFile}`, {
        timeout,
        cwd: workspacePath,
        encoding: "utf8",
      });

      return { stdout: stdout.trim(), exitCode: 0 };
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
