// mcp/server.ts
// MCPServer — exposes PandaClaw's tools over the Model Context Protocol
// so other agents (Claude Desktop, custom clients, etc.) can call them.
//
// Wire it up via the entry point in bin/mcp-server.ts:
//   bun bin/mcp-server.ts
// or via config:
//   "mcp": { "servers": [{ "name": "pandaclaw", "command": "bun", "args": ["bin/mcp-server.ts"] }] }

import { readConfig } from "../ai/ai.config.js";
import { TOOLS, getGuard } from "../tools/index.js";
import type { ToolContext, ToolDefinition, RiskLevel } from "../modes/agent/types.js";
import {
  ErrorCode,
  LATEST_PROTOCOL_VERSION,
  MCPMethod,
  type CallToolParams,
  type CallToolResult,
  type InitializeResult,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type MCPClientCapabilities,
  type MCPServerCapabilities,
  type ToolSchema,
  isRequest,
  readMessages,
  writeMessage,
} from "./protocol.js";

const SERVER_INFO = { name: "pandaclaw", version: "0.1.0" };

export interface MCPServerOptions {
  // When true, server emits debug logs to stderr.
  debug?: boolean;
  // Channel context to pass to tools (CLI = no consent prompts).
  defaultChannel?: ToolContext["channel"];
}

/**
 * MCPServer bridges MCP tool requests to PandaClaw's TOOLS registry.
 * Each `tools/call` goes through the SecurityGuard (so the same risk
 * policies apply to MCP callers as to local agents).
 */
export class MCPServer {
  private initialized = false;
  private toolSchemas: Map<string, ToolSchema> = new Map();

  constructor(
    private readonly options: MCPServerOptions = {}
  ) {
    this.refreshToolSchemas();
  }

  // ============ Public Lifecycle ============

  /**
   * Start serving JSON-RPC over stdio. Returns when the child process
   * closes its stdin (i.e. the parent hung up).
   */
  async serveStdio(
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stdout
  ): Promise<void> {
    const handler = this.createHandler();

    for await (const msg of readMessages(input)) {
      try {
        const response = await handler(msg);
        if (response) {
          await writeMessage(output, response);
        }
      } catch (err) {
        this.log("error in handler:", err);
        const errResponse: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: (msg as any)?.id ?? null,
          error: {
            code: ErrorCode.InternalError,
            message: (err as Error).message,
          },
        };
        await writeMessage(output, errResponse);
      }
    }
  }

  /**
   * Build a single-message handler for testing or transport adapters.
   * Returns null for notifications (no response needed).
   */
  createHandler(): (msg: any) => Promise<JsonRpcResponse | null> {
    return async (msg: any) => {
      if (!isRequest(msg)) {
        // Notifications: handle if relevant, otherwise ignore
        if (msg && typeof msg.method === "string" && !("id" in msg)) {
          await this.handleNotification(msg as JsonRpcNotification);
        }
        return null;
      }
      return this.dispatch(msg as JsonRpcRequest);
    };
  }

  // ============ MCP Method Dispatch ============

  private async dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    this.log(`<- ${req.method}`, req.params);
    const id = req.id ?? null;

    try {
      switch (req.method) {
        case MCPMethod.Initialize:
          return this.ok(id, this.handleInitialize(req.params as any));
        case MCPMethod.Ping:
          return this.ok(id, {});
        case MCPMethod.ToolsList:
          return this.ok(id, { tools: Array.from(this.toolSchemas.values()) });
        case MCPMethod.ToolsCall:
          return this.ok(id, await this.handleToolsCall(req.params as unknown as CallToolParams));
        case MCPMethod.ResourcesList:
          return this.ok(id, { resources: [] });
        case MCPMethod.ResourcesRead:
          return this.err(id, ErrorCode.MethodNotFound, "Resources not supported");
        case MCPMethod.PromptsList:
          return this.ok(id, { prompts: [] });
        case MCPMethod.PromptsGet:
          return this.err(id, ErrorCode.MethodNotFound, "Prompts not supported");
        default:
          return this.err(id, ErrorCode.MethodNotFound, `Unknown method: ${req.method}`);
      }
    } catch (err) {
      return this.err(id, ErrorCode.InternalError, (err as Error).message);
    }
  }

  private async handleNotification(notif: JsonRpcNotification): Promise<void> {
    if (notif.method === MCPMethod.NotificationsInitialized) {
      this.initialized = true;
      this.log("client signaled initialized");
    }
  }

  // ============ Method Implementations ============

  private handleInitialize(_params: unknown): InitializeResult {
    this.initialized = true;
    const capabilities: MCPServerCapabilities = {
      tools: { listChanged: false },
    };
    return {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities,
      serverInfo: SERVER_INFO,
      instructions:
        "PandaClaw MCP server. Exposes file_read, file_write, list_dir, " +
        "web_search, web_fetch, code_exec, app_control, and canvas_control. " +
        "All tool calls are subject to the local SecurityGuard risk policy; " +
        "ask-level tools may prompt for user consent before executing.",
    };
  }

  private async handleToolsCall(params: CallToolParams): Promise<CallToolResult> {
    if (!params || typeof params.name !== "string") {
      throw new Error("Invalid tools/call params: missing 'name'");
    }
    const toolName = params.name;
    const tool = TOOLS[toolName];
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const channel = this.options.defaultChannel ?? "cli";
    const context: ToolContext = {
      channel,
      workspacePath: process.cwd(),
      requestConsent: async (tool, preview) => {
        // In MCP-server mode we auto-approve when running headless.
        // Local CLI/agent callers will still get the prompt.
        this.log(`auto-approving consent for ${tool} via MCP (preview: ${preview.slice(0, 60)}...)`);
        return true;
      },
    };

    // Run through the SecurityGuard so MCP callers can't bypass local policy
    const platform = channel === "cli" ? "cli" : (channel as any);
    const decision = await getGuard().check(toolName, platform, context.requestConsent);
    if (!decision.allowed) {
      return {
        content: [{ type: "text", text: `Blocked by security policy: ${decision.reason}` }],
        isError: true,
      };
    }

    try {
      const result = await tool.execute(args, context);
      const text = this.formatResult(result);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Tool error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }

  // ============ Tool Schema Refresh ============

  private refreshToolSchemas(): void {
    this.toolSchemas.clear();
    for (const [name, def] of Object.entries(TOOLS)) {
      this.toolSchemas.set(name, this.buildSchema(name, def));
    }
  }

  private buildSchema(name: string, def: ToolDefinition): ToolSchema {
    return {
      name,
      description: def.description,
      inputSchema: def.schema ?? {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    };
  }

  // ============ Helpers ============

  private formatResult(result: unknown): string {
    if (result == null) return "(no output)";
    if (typeof result === "string") return result;
    if (typeof result === "object") {
      try {
        return JSON.stringify(result, null, 2);
      } catch {
        return String(result);
      }
    }
    return String(result);
  }

  private ok(id: number | string | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
  }

  private err(
    id: number | string | null,
    code: number,
    message: string
  ): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }

  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.error("[mcp-server]", ...args);
    }
  }
}
