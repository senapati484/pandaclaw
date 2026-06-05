// tests/code-exec.test.ts
// Unit tests for codeExecTool command executor

import { expect, test, describe } from "bun:test";
import { codeExecTool } from "../tools/code-exec.ts";
import type { ToolContext } from "../modes/agent/types.js";

const mockContext: ToolContext = {
  userId: "test-user-id",
  channel: "cli",
  requestConsent: async () => true,
  workspacePath: process.cwd(),
};

describe("codeExecTool", () => {
  test("executes a simple command successfully", async () => {
    const res = await codeExecTool.execute({ code: "echo 'hello world'" }, mockContext) as any;
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("hello world");
  });

  test("handles non-zero exit codes correctly", async () => {
    const res = await codeExecTool.execute({ code: "exit 42" }, mockContext) as any;
    expect(res.exitCode).toBe(42);
  });

  test("handles syntax/command errors correctly", async () => {
    const res = await codeExecTool.execute({ code: "nonexistentcommand12345" }, mockContext) as any;
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr || res.stdout).toBeDefined();
  });
});
