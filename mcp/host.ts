// mcp/host.ts
// MCPHost — manages connections to MCP servers via stdio.
// Each server runs as a child process; tool names are namespaced as
// `<serverName>__<toolName>` and registered into the global TOOLS registry.

import { spawn, type ChildProcess } from "child_process";
import {
  ErrorCode,
  MCPMethod,
  LATEST_PROTOCOL_VERSION,
  type CallToolParams,
  type CallToolResult,
  type InitializeParams,
  type InitializeResult,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ToolSchema,
  isRequest,
  readMessages,
  writeMessage,
} from "./protocol.js";
import { readConfig } from "../ai/ai.config.js";
import type { ToolDefinition, ToolContext, RiskLevel } from "../modes/agent/types.js";

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  autoReconnect?: boolean;
}

export interface MCPServerStatus {
  name: string;
  connected: boolean;
  lastError?: string;
  toolCount: number;
  reconnectAttempts: number;
  initializedAt?: Date;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  method: string;
}

interface ServerState {
  config: MCPServerConfig;
  process?: ChildProcess;
  status: MCPServerStatus;
  nextId: number;
  pending: Map<number | string, PendingRequest>;
  toolIndex: Map<string, ToolSchema>; // local tool name -> schema
  reconnectTimer?: NodeJS.Timeout;
}

const DEFAULT_RECONNECT_BASE_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

export class MCPHost {
  private servers: Map<string, ServerState> = new Map();
  private toolsRegistered: Set<string> = new Set();
  private toolRegistry: Record<string, ToolDefinition> = {};
  private notificationHandlers: ((server: string, notif: JsonRpcNotification) => void)[] = [];

  constructor(
    private readonly toolRegistryTarget: Record<string, ToolDefinition>,
    private readonly onToolsChanged?: (registeredTools: string[]) => void
  ) {
    this.toolRegistry = toolRegistryTarget;
  }

  /**
   * Spawn all configured MCP servers, perform the initialize handshake,
   * discover their tools, and register them into the global tool registry.
   */
  async connect(servers: MCPServerConfig[]): Promise<void> {
    await Promise.all(
      servers.map(async (cfg) => {
        if (this.servers.has(cfg.name)) {
          return; // already connected (idempotent)
        }
        const state = this.createState(cfg);
        this.servers.set(cfg.name, state);
        try {
          await this.spawnAndInitialize(state);
        } catch (err) {
          state.status.lastError = (err as Error).message;
        }
      })
    );
  }

  /**
   * Connect to a single server by name, using config from ai.config.json.
   */
  async connectServer(name: string): Promise<MCPServerStatus> {
    const cfg = this.readServersFromConfig().find((s) => s.name === name);
    if (!cfg) {
      throw new Error(`MCP server "${name}" not found in config`);
    }
    const state = this.createState(cfg);
    this.servers.set(name, state);
    await this.spawnAndInitialize(state);
    return state.status;
  }

  /**
   * Read MCP server configs from the panda config under `mcp.servers`.
   */
  readServersFromConfig(): MCPServerConfig[] {
    try {
      const cfg = readConfig() as any;
      const list = cfg?.mcp?.servers;
      if (!Array.isArray(list)) return [];
      return list.filter(
        (s: any) => s && typeof s.name === "string" && typeof s.command === "string"
      );
    } catch {
      return [];
    }
  }

  /**
   * Get the current status of a server (or all servers if no name given).
   */
  status(name?: string): MCPServerStatus | MCPServerStatus[] {
    if (name) {
      const s = this.servers.get(name);
      if (!s) throw new Error(`Unknown MCP server: ${name}`);
      return s.status;
    }
    return Array.from(this.servers.values()).map((s) => s.status);
  }

  /**
   * Get the namespaced tool names currently registered from MCP servers.
   */
  registeredTools(): string[] {
    return Array.from(this.toolsRegistered);
  }

  /**
   * Manually call a tool on a server. The namespaced name is `<server>__<tool>`.
   */
  async callTool(namespacedName: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const parsed = this.parseNamespaced(namespacedName);
    if (!parsed) {
      throw new Error(`Invalid MCP tool name: ${namespacedName} (expected "server__tool")`);
    }
    return this.sendRequest(parsed.server, MCPMethod.ToolsCall, {
      name: parsed.tool,
      arguments: args,
    } as CallToolParams);
  }

  /**
   * Disconnect from one or all MCP servers and unregister their tools.
   */
  async disconnect(name?: string): Promise<void> {
    if (name) {
      const state = this.servers.get(name);
      if (state) {
        await this.teardownServer(state);
        this.servers.delete(name);
      }
    } else {
      await Promise.all(
        Array.from(this.servers.values()).map((s) => this.teardownServer(s))
      );
      this.servers.clear();
    }
  }

  /**
   * Has the given server been registered with the host? (true even after disconnect)
   */
  hasServer(name: string): boolean {
    return this.servers.has(name);
  }

  onNotification(handler: (server: string, notif: JsonRpcNotification) => void): void {
    this.notificationHandlers.push(handler);
  }

  // ============ Internal Plumbing ============

  private createState(config: MCPServerConfig): ServerState {
    return {
      config,
      status: {
        name: config.name,
        connected: false,
        toolCount: 0,
        reconnectAttempts: 0,
      },
      nextId: 1,
      pending: new Map(),
      toolIndex: new Map(),
    };
  }

  private async spawnAndInitialize(state: ServerState): Promise<void> {
    const { config } = state;

    if (config.autoReconnect === false) {
      // still allow manual reconnect through reconnect()
    }

    const proc = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    state.process = proc;

    proc.on("error", (err) => {
      state.status.lastError = `Process error: ${err.message}`;
      this.handleDisconnect(state);
    });

    proc.on("exit", (code, signal) => {
      state.status.lastError = `Exited (code=${code}, signal=${signal})`;
      this.handleDisconnect(state);
    });

    // Route incoming messages
    (async () => {
      try {
        for await (const msg of readMessages(proc.stdout!)) {
          this.handleMessage(state, msg);
        }
      } catch (err) {
        state.status.lastError = `Read error: ${(err as Error).message}`;
        this.handleDisconnect(state);
      }
    })();

    proc.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      state.status.lastError = `stderr: ${text.trim().split("\n").pop() ?? text}`;
    });

    // Send initialize
    const initParams: InitializeParams = {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: "pandaclaw-host", version: "0.1.0" },
    };

    const initResult = (await this.sendRequestOnState(state, MCPMethod.Initialize, initParams)) as InitializeResult;
    state.status.initializedAt = new Date();

    // Tell server we're initialized
    await writeMessage(proc.stdin!, {
      jsonrpc: "2.0",
      method: MCPMethod.NotificationsInitialized,
      params: {},
    });

    // Discover tools
    const list = (await this.sendRequestOnState(state, MCPMethod.ToolsList, {})) as { tools: ToolSchema[] };
    state.toolIndex.clear();
    for (const tool of list.tools ?? []) {
      state.toolIndex.set(tool.name, tool);
    }
    state.status.toolCount = state.toolIndex.size;
    state.status.connected = true;
    state.status.lastError = undefined;

    this.registerServerTools(state);
    this.onToolsChanged?.(Array.from(this.toolsRegistered));
  }

  private async sendRequestOnState(
    state: ServerState,
    method: string,
    params: unknown
  ): Promise<any> {
    if (!state.process?.stdin) {
      throw new Error("Server process not running");
    }
    const id = state.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params: params as any };

    return new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject, method });
      writeMessage(state.process!.stdin!, req).catch((err) => {
        state.pending.delete(id);
        reject(err);
      });
    });
  }

  private sendRequest(server: string, method: string, params: unknown): Promise<any> {
    const state = this.servers.get(server);
    if (!state) throw new Error(`MCP server "${server}" not connected`);
    return this.sendRequestOnState(state, method, params);
  }

  private handleMessage(state: ServerState, msg: any): void {
    if (isRequest(msg)) {
      // server is making a request of us; we don't currently handle sampling/roots
      const err: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: msg.id ?? null,
        error: { code: ErrorCode.MethodNotFound, message: `Host does not support method: ${msg.method}` },
      };
      if (state.process?.stdin) {
        writeMessage(state.process.stdin, err).catch(() => {});
      }
      return;
    }

    if ("error" in msg || "result" in msg) {
      const resp = msg as JsonRpcResponse;
      const pending = state.pending.get(resp.id as number);
      if (!pending) return;
      state.pending.delete(resp.id as number);
      if (resp.error) {
        const err = new Error(`MCP error: ${resp.error.message} (code=${resp.error.code})`);
        (err as any).code = resp.error.code;
        (err as any).data = resp.error.data;
        pending.reject(err);
      } else {
        pending.resolve(resp.result);
      }
      return;
    }

    if (typeof msg.method === "string" && !("id" in msg)) {
      // server-initiated notification (e.g. tools/list_changed)
      for (const handler of this.notificationHandlers) {
        try {
          handler(state.config.name, msg as JsonRpcNotification);
        } catch {
          // swallow handler errors
        }
      }
      if (msg.method === "notifications/tools/list_changed") {
        // Re-discover tools
        this.sendRequestOnState(state, MCPMethod.ToolsList, {})
          .then((res: any) => {
            state.toolIndex.clear();
            for (const tool of res.tools ?? []) {
              state.toolIndex.set(tool.name, tool);
            }
            state.status.toolCount = state.toolIndex.size;
            this.unregisterServerTools(state);
            this.registerServerTools(state);
            this.onToolsChanged?.(Array.from(this.toolsRegistered));
          })
          .catch((err) => {
            state.status.lastError = `Re-list failed: ${(err as Error).message}`;
          });
      }
    }
  }

  private handleDisconnect(state: ServerState): void {
    if (!state.status.connected) return;
    state.status.connected = false;
    this.unregisterServerTools(state);

    if (state.config.autoReconnect === false) return;

    state.status.reconnectAttempts++;
    const delay = Math.min(
      DEFAULT_RECONNECT_BASE_MS * 2 ** Math.min(state.status.reconnectAttempts, 5),
      DEFAULT_RECONNECT_MAX_MS
    );
    state.reconnectTimer = setTimeout(() => {
      this.spawnAndInitialize(state).catch((err) => {
        state.status.lastError = `Reconnect failed: ${err.message}`;
        this.handleDisconnect(state);
      });
    }, delay);
  }

  private async teardownServer(state: ServerState): Promise<void> {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = undefined;
    }
    state.config.autoReconnect = false;
    this.unregisterServerTools(state);
    if (state.process && !state.process.killed) {
      state.process.kill("SIGTERM");
      // give it 500ms to exit cleanly
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 500);
        state.process!.on("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    // Reject any pending requests
    for (const [id, pending] of state.pending) {
      pending.reject(new Error("Server disconnected"));
    }
    state.pending.clear();
    state.toolIndex.clear();
    state.status.connected = false;
  }

  private registerServerTools(state: ServerState): void {
    for (const [toolName, schema] of state.toolIndex) {
      const namespaced = `${state.config.name}__${toolName}`;
      this.toolsRegistered.add(namespaced);

      // Convert MCP JSON schema to a permissive "any" zod shape;
      // we don't enforce the schema at the host boundary — the server does.
      const risk = this.inferRiskFromName(toolName);
      const toolDef: ToolDefinition = {
        name: namespaced,
        description: `[MCP:${state.config.name}] ${schema.description ?? toolName}`,
        riskLevel: risk,
        readOnly: risk === "safe",
        schema: schema.inputSchema,
        execute: async (
          args: Record<string, unknown>,
          _ctx: ToolContext
        ): Promise<CallToolResult> => {
          return this.callTool(namespaced, args);
        },
      };
      this.toolRegistry[namespaced] = toolDef;
    }
  }

  private unregisterServerTools(state: ServerState): void {
    for (const toolName of state.toolIndex.keys()) {
      const namespaced = `${state.config.name}__${toolName}`;
      this.toolsRegistered.delete(namespaced);
      delete this.toolRegistry[namespaced];
    }
    this.onToolsChanged?.(Array.from(this.toolsRegistered));
  }

  private inferRiskFromName(name: string): RiskLevel {
    const lower = name.toLowerCase();
    if (
      lower.includes("delete") ||
      lower.includes("remove") ||
      lower.includes("write") ||
      lower.includes("exec") ||
      lower.includes("run") ||
      lower.includes("shell") ||
      lower.includes("bash") ||
      lower.includes("create")
    ) {
      return "ask";
    }
    return "safe";
  }

  private parseNamespaced(name: string): { server: string; tool: string } | null {
    const idx = name.indexOf("__");
    if (idx <= 0 || idx === name.length - 2) return null;
    return { server: name.slice(0, idx), tool: name.slice(idx + 2) };
  }
}

// ============ Singleton Helper ============

let _host: MCPHost | null = null;

export function getMCPHost(
  toolRegistry: Record<string, ToolDefinition>,
  onToolsChanged?: (tools: string[]) => void
): MCPHost {
  if (!_host) {
    _host = new MCPHost(toolRegistry, onToolsChanged);
  }
  return _host;
}
