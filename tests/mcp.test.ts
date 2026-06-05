// tests/mcp.test.ts
// Verifies MCP protocol framing, host lifecycle, and tool registration.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { encodeMessage, readMessages, writeMessage, isRequest, isResponse, ErrorCode, MCPMethod } from "../mcp/protocol.ts";
import { MCPHost } from "../mcp/host.ts";
import type { ToolDefinition } from "../modes/agent/types.ts";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import path from "path";
import os from "os";

describe("MCP protocol", () => {
  test("encodeMessage produces LSP-style framing", () => {
    const msg = { jsonrpc: "2.0", id: 1, method: "ping", params: {} };
    const encoded = encodeMessage(msg);
    const body = JSON.stringify(msg);
    expect(encoded).toBe(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  });

  test("readMessages parses framed JSON-RPC", async () => {
    const a = { jsonrpc: "2.0", id: 1, method: "ping" };
    const b = { jsonrpc: "2.0", id: 2, result: { ok: true } };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(encodeMessage(a)));
        controller.enqueue(new TextEncoder().encode(encodeMessage(b)));
        controller.close();
      },
    });
    const received: any[] = [];
    for await (const m of readMessages(stream)) received.push(m);
    expect(received.length).toBe(2);
    expect(isRequest(received[0])).toBe(true);
    expect(isResponse(received[1])).toBe(true);
  });

  test("isRequest / isResponse type guards", () => {
    expect(isRequest({ jsonrpc: "2.0", id: 1, method: "x" })).toBe(true);
    expect(isRequest({ jsonrpc: "2.0", method: "x" })).toBe(false);
    expect(isResponse({ jsonrpc: "2.0", id: 1, result: {} })).toBe(true);
    expect(isResponse({ jsonrpc: "2.0", id: 1, error: { code: 1, message: "x" } })).toBe(true);
  });

  test("ErrorCode values are JSON-RPC 2.0 standard", () => {
    expect(ErrorCode.ParseError).toBe(-32700);
    expect(ErrorCode.MethodNotFound).toBe(-32601);
  });

  test("MCPMethod constants are stable", () => {
    expect(MCPMethod.Initialize).toBe("initialize");
    expect(MCPMethod.ToolsList).toBe("tools/list");
    expect(MCPMethod.ToolsCall).toBe("tools/call");
  });
});

describe("MCP host — end-to-end with mock server", () => {
  let serverScript: string;
  let tmpDir: string;
  const toolRegistry: Record<string, ToolDefinition> = {};
  let host: MCPHost;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pandaclaw-mcp-"));
    serverScript = path.join(tmpDir, "mock-server.ts");
    // A minimal MCP server: implements initialize, tools/list, tools/call
    writeFileSync(
      serverScript,
      `
import {
  encodeMessage, readMessages, writeMessage,
  MCPMethod, LATEST_PROTOCOL_VERSION,
  type ToolSchema
} from "${path.resolve("./mcp/protocol.ts").replace(/\\\\/g, "/")}";

const TOOLS: ToolSchema[] = [
  { name: "echo", description: "Echoes input", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "danger_write", description: "Writes a file", inputSchema: { type: "object", properties: { path: { type: "string" } } } }
];

async function main() {
  const stdin = process.stdin;
  const stdout = process.stdout;
  for await (const msg of readMessages(stdin)) {
    if (!msg || !("id" in msg)) continue;
    const id = msg.id;
    if (msg.method === MCPMethod.Initialize) {
      await writeMessage(stdout, {
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "mock", version: "1.0.0" }
        }
      });
      continue;
    }
    if (msg.method === MCPMethod.ToolsList) {
      await writeMessage(stdout, { jsonrpc: "2.0", id, result: { tools: TOOLS } });
      continue;
    }
    if (msg.method === MCPMethod.ToolsCall) {
      const p = msg.params as any;
      if (p?.name === "echo") {
        await writeMessage(stdout, {
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: "echo: " + (p.arguments?.text ?? "") }] }
        });
      } else if (p?.name === "danger_write") {
        await writeMessage(stdout, {
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: "wrote to " + p.arguments?.path }] }
        });
      } else {
        await writeMessage(stdout, { jsonrpc: "2.0", id, error: { code: -32601, message: "unknown" } });
      }
      continue;
    }
    await writeMessage(stdout, { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
`
    );
    host = new MCPHost(toolRegistry);
  });

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  test("connects to a server, discovers tools, and registers them with namespace", async () => {
    await host.connect([{ name: "mock", command: "bun", args: [serverScript] }]);

    const status = host.status("mock") as any;
    expect(status.connected).toBe(true);
    expect(status.toolCount).toBe(2);

    const registered = host.registeredTools();
    expect(registered).toContain("mock__echo");
    expect(registered).toContain("mock__danger_write");
    expect(toolRegistry["mock__echo"]).toBeDefined();
    expect(toolRegistry["mock__danger_write"]).toBeDefined();

    // risk inferred from name
    expect(toolRegistry["mock__echo"]!.riskLevel).toBe("safe");
    expect(toolRegistry["mock__danger_write"]!.riskLevel).toBe("ask");
  }, 30_000);

  test("calls a tool end-to-end via namespaced name", async () => {
    const result: any = await host.callTool("mock__echo", { text: "hello" });
    expect(result.content[0].text).toBe("echo: hello");
  }, 10_000);

  test("disconnects and unregisters tools", async () => {
    expect(host.hasServer("mock")).toBe(true);
    await host.disconnect("mock");
    expect(host.hasServer("mock")).toBe(false);
    expect(toolRegistry["mock__echo"]).toBeUndefined();
    expect(toolRegistry["mock__danger_write"]).toBeUndefined();
  }, 10_000);

  test("handles unknown namespaced name gracefully", async () => {
    await expect(host.callTool("badformat", {})).rejects.toThrow(/Invalid MCP tool name/);
    await expect(host.callTool("server__", {})).rejects.toThrow(/Invalid MCP tool name/);
  });

  test("getMCPHost reads from config when mcp.servers is empty", () => {
    const configs = host.readServersFromConfig();
    expect(Array.isArray(configs)).toBe(true);
  });
});
