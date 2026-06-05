// tests/mcp-roundtrip.test.ts
// Full round-trip: MCPHost connects to the real PandaClaw MCP server
// (via bin/mcp-server.ts), discovers tools, and calls one end-to-end.

import { describe, expect, test, afterAll } from "bun:test";
import { MCPHost } from "../mcp/host.ts";
import type { ToolDefinition } from "../modes/agent/types.ts";
import path from "path";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import * as os from "os";

const SERVER_BIN = path.resolve(import.meta.dir, "..", "bin", "mcp-server.ts");

describe("MCP host <-> PandaClaw server (full round-trip)", () => {
  let host: MCPHost;
  const toolRegistry: Record<string, ToolDefinition> = {};
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pandaclaw-rt-"));
  const testFile = path.join(tmpDir, "roundtrip.txt");
  writeFileSync(testFile, "round-trip content\n");

  afterAll(() => {
    host?.disconnect("pandaclaw").catch(() => {});
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test("host connects to the real bin/mcp-server.ts and lists tools", async () => {
    host = new MCPHost(toolRegistry);
    await host.connect([
      { name: "pandaclaw", command: "bun", args: [SERVER_BIN] },
    ]);

    const status = host.status("pandaclaw") as any;
    expect(status.connected).toBe(true);
    expect(status.toolCount).toBeGreaterThan(0);

    const tools = host.registeredTools();
    expect(tools.some((t) => t.startsWith("pandaclaw__file_read"))).toBe(true);
    expect(tools.some((t) => t.startsWith("pandaclaw__list_dir"))).toBe(true);
  }, 30_000);

  test("host calls file_read on the real server and gets content back", async () => {
    const result: any = await host.callTool("pandaclaw__file_read", { path: testFile });
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("round-trip content");
  }, 30_000);

  test("host calls list_dir and gets directory contents", async () => {
    const result: any = await host.callTool("pandaclaw__list_dir", { path: tmpDir, recursive: false });
    expect(result.content[0].text).toContain("roundtrip.txt");
  }, 30_000);

  test("host disconnects cleanly", async () => {
    await host.disconnect("pandaclaw");
    expect(host.hasServer("pandaclaw")).toBe(false);
  }, 10_000);
});
