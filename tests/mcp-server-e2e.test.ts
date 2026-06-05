// tests/mcp-server-e2e.test.ts
// Verifies the bin/mcp-server.ts entry point works when spawned as a real child process.

import { describe, expect, test, afterAll } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { encodeMessage } from "../mcp/protocol.ts";

const SERVER = path.resolve(import.meta.dir, "..", "bin", "mcp-server.ts");

import path from "path";

describe("MCP server entry point (spawned)", () => {
  let proc: ChildProcess | null = null;

  afterAll(() => {
    if (proc && !proc.killed) proc.kill("SIGKILL");
  });

  function startServer(): ChildProcess {
    return spawn("bun", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  }

  function readOneResponse(p: ChildProcess, timeoutMs = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("timeout waiting for response")), timeoutMs);
      p.stdout!.setEncoding("utf8");
      p.stdout!.on("data", (chunk: string) => {
        buf += chunk;
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buf.slice(0, headerEnd);
        const m = header.match(/Content-Length:\s*(\d+)/i);
        if (!m) return;
        const len = parseInt(m[1]!, 10);
        const bodyStart = headerEnd + 4;
        if (buf.length < bodyStart + len) return;
        const body = buf.slice(bodyStart, bodyStart + len);
        clearTimeout(timer);
        p.stdout!.removeAllListeners("data");
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  test("responds to initialize when spawned as a child process", async () => {
    proc = startServer();
    const req = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-host", version: "0.0.1" },
      },
    };
    proc.stdin!.write(encodeMessage(req));
    proc.stdin!.write(encodeMessage({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }));
    proc.stdin!.end();

    const resp = await readOneResponse(proc);
    expect(resp.id).toBe(1);
    expect(resp.result.serverInfo.name).toBe("pandaclaw");
    expect(resp.result.capabilities.tools).toBeDefined();
  }, 10_000);

  test("handles tools/list and tools/call end-to-end", async () => {
    const p = startServer();
    p.stdin!.write(
      encodeMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      })
    );

    const listResp = await readOneResponse(p);
    expect(listResp.id).toBe(2);
    const names = listResp.result.tools.map((t: any) => t.name);
    expect(names).toContain("list_dir");
    p.kill("SIGKILL");
  }, 10_000);
});
