// tests/mcp-server.test.ts
// Verifies the PandaClaw MCP server: schema, dispatch, and integration
// with the tool registry. Uses in-process streams rather than spawning.

import { describe, expect, test, beforeAll } from "bun:test";
import { encodeMessage, readMessages, writeMessage } from "../mcp/protocol.ts";
import { MCPServer } from "../mcp/server.ts";
import { Readable, Writable } from "stream";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import path from "path";
import * as os from "os";

describe("MCPServer", () => {
  let tmpDir: string;
  let testFile: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pandaclaw-mcpsrv-"));
    testFile = path.join(tmpDir, "hello.txt");
    writeFileSync(testFile, "hello mcp world\n");
  });

  function makeServer(debug = false): MCPServer {
    return new MCPServer({ debug, defaultChannel: "cli" });
  }

  test("createHandler responds to initialize with serverInfo", async () => {
    const server = makeServer();
    const handler = server.createHandler();
    const resp: any = await handler({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.0.1" } },
    });
    expect(resp).not.toBeNull();
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.result.serverInfo.name).toBe("pandaclaw");
    expect(resp.result.protocolVersion).toBe("2024-11-05");
    expect(resp.result.capabilities.tools).toBeDefined();
  });

  test("createHandler responds to ping with empty result", async () => {
    const server = makeServer();
    const handler = server.createHandler();
    const resp: any = await handler({ jsonrpc: "2.0", id: 7, method: "ping", params: {} });
    expect(resp.id).toBe(7);
    expect(resp.result).toEqual({});
  });

  test("tools/list returns all registered tools", async () => {
    const server = makeServer();
    const handler = server.createHandler();
    const resp: any = await handler({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = resp.result.tools as any[];
    const names = tools.map((t) => t.name);
    expect(names).toContain("file_read");
    expect(names).toContain("file_write");
    expect(names).toContain("list_dir");
    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
    expect(names).toContain("code_exec");
    expect(names).toContain("app_control");
    expect(names).toContain("canvas_control");
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
    }
  });

  test("tools/call list_dir works and returns formatted text", async () => {
    const server = makeServer();
    const handler = server.createHandler();
    const resp: any = await handler({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "list_dir",
        arguments: { path: tmpDir, recursive: false },
      },
    });
    expect(resp.result.isError).toBeFalsy();
    expect(resp.result.content[0].type).toBe("text");
    expect(resp.result.content[0].text).toContain("hello.txt");
  });

  test("tools/call file_read works", async () => {
    const server = makeServer();
    const handler = server.createHandler();
    const resp: any = await handler({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "file_read", arguments: { path: testFile } },
    });
    expect(resp.result.isError).toBeFalsy();
    expect(resp.result.content[0].text).toContain("hello mcp world");
  });

  test("tools/call unknown tool returns isError=true with helpful message", async () => {
    const server = makeServer();
    const handler = server.createHandler();
    const resp: any = await handler({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "definitely_not_a_tool", arguments: {} },
    });
    expect(resp.result.isError).toBe(true);
    expect(resp.result.content[0].text).toMatch(/Unknown tool/);
  });

  test("unknown method returns MethodNotFound", async () => {
    const server = makeServer();
    const handler = server.createHandler();
    const resp: any = await handler({
      jsonrpc: "2.0",
      id: 6,
      method: "some/unknown/method",
      params: {},
    });
    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32601);
  });

  test("unsupported resources/list returns empty list (not an error)", async () => {
    const server = makeServer();
    const handler = server.createHandler();
    const resp: any = await handler({
      jsonrpc: "2.0",
      id: 8,
      method: "resources/list",
      params: {},
    });
    expect(resp.result.resources).toEqual([]);
  });

  test("notifications (no id) are not replied to", async () => {
    const server = makeServer();
    const handler = server.createHandler();
    const resp = await handler({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    expect(resp).toBeNull();
  });

  test("end-to-end over streams: client writes framed request, server writes framed response", async () => {
    const server = makeServer();
    // Build duplex pair using pass-through streams
    const requestBody = encodeMessage({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/list",
      params: {},
    });

    const input = Readable.from([Buffer.from(requestBody, "utf8")]);
    const captured: Buffer[] = [];
    const output = new Writable({
      write(chunk, _enc, cb) {
        captured.push(Buffer.from(chunk));
        cb();
      },
    });

    // serveStdio resolves when input closes
    await server.serveStdio(input, output);

    const out = Buffer.concat(captured).toString("utf8");
    // The response should be framed
    const headerEnd = out.indexOf("\r\n\r\n");
    expect(headerEnd).toBeGreaterThan(0);
    const body = out.slice(headerEnd + 4);
    const parsed = JSON.parse(body);
    expect(parsed.id).toBe(42);
    expect(parsed.result.tools).toBeDefined();
  });
});

// Cleanup tmp dir at process exit
process.on("exit", () => {
  try {
    const tmpDirs = Array.from(
      new Bun.Glob("/tmp/pandaclaw-mcpsrv-*").scanSync({ cwd: "/tmp" })
    );
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  } catch {}
});
