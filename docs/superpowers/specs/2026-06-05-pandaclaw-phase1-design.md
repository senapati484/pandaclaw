# PandaClaw Phase 1: Core Competitiveness

**Date:** 2026-06-05
**Status:** Draft
**Goal:** Close the competitive gap with OpenClaw by adding MCP support, semantic memory, prompt injection defense, and a channel plugin architecture — while staying Bun-native and zero-cost.

---

## 1. Channel Adapter Interface

### Problem

Telegram, Slack, and WebChat adapters each have different shapes — different initialization, message handling, and lifecycle methods. Adding a new channel (Discord, Signal, WhatsApp) means writing a fourth from scratch with no guidance.

### Design

Extract a `ChannelAdapter` interface that all channels implement. The `Gateway` class becomes a registry with no channel-specific logic.

```typescript
// modes/gateway/channel-adapter.ts

interface Attachment {
  type: "image" | "audio" | "file"
  data: Buffer
  mimeType: string
  fileName?: string
}

interface ChannelRecipient {
  channelId: string
  threadId?: string
}

interface InboundMessage {
  id: string
  text: string
  senderId: string
  senderName: string
  channelId: string
  attachments?: Attachment[]
}

interface OutboundMessage {
  text: string
  attachments?: Attachment[]
}

interface ChannelHealth {
  ok: boolean
  latencyMs?: number
  error?: string
}

interface ChannelAdapter {
  readonly name: string
  readonly platform: string

  start(): Promise<void>
  stop(): Promise<void>
  send(recipient: ChannelRecipient, message: OutboundMessage): Promise<void>
  onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): void
  health(): ChannelHealth
}
```

### Gateway Changes

```typescript
// modes/gateway/index.ts

class Gateway {
  private adapters = new Map<string, ChannelAdapter>()
  private messageHandler: ((msg: InboundMessage) => Promise<OutboundMessage | null>) | null = null

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.platform, adapter)
    adapter.onMessage(async (msg) => {
      return this.messageHandler?.(msg) ?? null
    })
  }

  onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): void {
    this.messageHandler = handler
  }

  async start(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.start()
    }
  }

  async stop(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stop()
    }
  }

  async broadcast(message: OutboundMessage, source?: string): Promise<void> {
    for (const [platform, adapter] of this.adapters) {
      if (platform === source) continue
      await adapter.send({ channelId: "*" }, message)
    }
  }
}
```

### Existing Adapter Migration

Each existing adapter wraps its current logic behind the interface:

- **TelegramAdapter**: `start()` = bot polling init. `onMessage()` = wire up bot.on("message"). `send()` = `bot.sendMessage()`. Health = polling status.
- **SlackAdapter**: `start()` = webhook listener. `onMessage()` = wire up event handler. `send()` = webhook POST. Health = last webhook timestamp.
- **WebChatAdapter**: `start()` = SSE listener init. `onMessage()` = wire up message callback. `send()` = SSE push. Health = connection count.

### Non-goals

- No channel auto-discovery
- No per-channel authentication flows (handled by adapter constructors)
- No message queue or delivery guarantees (best-effort, same as today)

---

## 2. MCP Dual-Mode: Host + Server

### Problem

PandaClaw's tool set is fixed to built-in tools + dynamic skills. There's no way to connect to the MCP ecosystem (filesystem, puppeteer, GitHub, Vercel, etc.) or expose PandaClaw's device-control tools to other agents.

### Design

Two independent systems sharing the MCP protocol layer:

```
mcp/
  protocol.ts    ← JSON-RPC types, transport helpers (stdio, SSE)
  host.ts        ← connect to MCP servers, expose their tools
  server.ts      ← expose PandaClaw tools as an MCP server
```

### Protocol Layer (mcp/protocol.ts)

Minimal JSON-RPC 2.0 implementation:

```typescript
interface MCPRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: Record<string, unknown>
}

interface MCPResponse {
  jsonrpc: "2.0"
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

// Transport: line-delimited JSON over stdio
async function readMessage(stream: ReadableStream): Promise<MCPRequest>
async function writeMessage(stream: WritableStream, msg: MCPResponse): Promise<void>
```

### Host Mode (mcp/host.ts)

On startup, read configured MCP servers from `config.json`. For each server, spawn the process (or connect via SSE), discover tools via `tools/list`, and register each tool into PandaClaw's tool registry.

```typescript
class MCPHost {
  private servers: MCPServerConnection[] = []

  async connectAll(config: MCPServerConfig[]): Promise<void>
  async disconnectAll(): Promise<void>
  
  // Called by tool registry on every request
  async callTool(serverName: string, toolName: string, args: unknown): Promise<unknown>
}

interface MCPServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}
```

Tool discovery flow:
1. Spawn `command args` with env vars
2. Send `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
3. Parse response → array of tool definitions
4. Register each as a PandaClaw tool, prefixed with server name (e.g., `github_create_issue`, `filesystem_read_file`)
5. On tool call → send `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"...","arguments":{...}}}`

Keep-alive: process stdin/stdout stays open. On disconnect, attempt reconnect (exponential backoff, 3 retries).

### Server Mode (mcp/server.ts)

Expose PandaClaw's tool registry as an MCP server over stdio and/or SSE.

```typescript
class MCPServer {
  constructor(private tools: ToolRegistry)

  // Spawn as stdio server (for Claude Code, Cursor, Codex)
  startStdio(): void

  // Serve over HTTP (for remote agents)
  startHTTP(port: number): void
}
```

When a client connects and sends `tools/list`, respond with all PandaClaw tools mapped to MCP tool format. When client sends `tools/call`, execute the tool and return the result.

### Config

```json
{
  "mcp": {
    "servers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"]
      }
    },
    "server": {
      "enabled": true,
      "port": 18790
    }
  }
}
```

### Testing

- Unit test JSON-RPC message framing
- Integration test: spawn a test MCP server, connect via host, verify tool discovery
- Integration test: start MCP server mode, connect via stdio, verify `tools/call` executes a real tool

---

## 3. SQLite-vec RAG

### Problem

Current `recallRelevant()` uses TF-IDF keyword overlap — fast (<1ms) but misses semantic relationships. "buy a house" and "purchase real estate" score zero similarity.

### Design

Three-layer recall: **Vector (primary) → TF-IDF (timeout fallback) → Keyword (last resort)**.

New files:
```
memory/
  embedder.ts    ← wraps @xenova/transformers, manages model lifecycle
  vector-store.ts ← sqlite-vec read/write/search
  memory.ts      ← orchestrator: try vector → fallback TF-IDF
  schema.sql     ← SQLite schema for vector tables
```

### Embedder (memory/embedder.ts)

```typescript
class Embedder {
  private model: Pipeline | null = null
  private ready: Promise<void>

  constructor() {
    this.ready = this.load()
  }

  private async load(): Promise<void> {
    const { pipeline } = await import("@xenova/transformers")
    this.model = await pipeline("embeddings", "Xenova/all-MiniLM-L6-v2")
  }

  async embed(text: string, timeoutMs = 500): Promise<number[] | null> {
    await Promise.race([this.ready, sleep(timeoutMs)])
    if (!this.model) return null
    const result = await this.model(text, { pooling: "mean", normalize: true })
    return Array.from(result.data)
  }
}
```

One-time ~80MB download of `all-MiniLM-L6-v2` on first use. Model is cached in `~/.pandaclaw/models/`. Subsequent startups load from disk in ~100ms.

### Vector Store (memory/vector-store.ts)

Uses `bun:sqlite` with the `sqlite-vec` extension loaded:

```typescript
class VectorStore {
  private db: Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.loadExtension("vec0")  // sqlite-vec vector extension
    this.db.run(schema)
  }

  async insert(id: string, content: string, metadata: Record<string, unknown>, vector: number[]) {
    this.db.run("INSERT INTO memories (id, content, metadata) VALUES (?, ?, ?)", [id, content, JSON.stringify(metadata)])
    this.db.run("INSERT INTO vec_memories (id, embedding) VALUES (?, ?)", [id, new Float32Array(vector)])
  }

  async search(queryVector: number[], limit = 10): Promise<SearchResult[]> {
    return this.db.query(`
      SELECT m.id, m.content, m.metadata, v.distance
      FROM vec_memories v
      JOIN memories m ON m.id = v.id
      WHERE v.embedding MATCH ?
      ORDER BY v.distance
      LIMIT ?
    `).all(new Float32Array(queryVector), limit)
  }
}
```

### Schema (memory/schema.sql)

```sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0 (
  id TEXT PRIMARY KEY,
  embedding FLOAT[384]  -- all-MiniLM-L6-v2 produces 384-dim vectors
);
```

### Memory Orchestrator (memory/memory.ts)

The existing `memory/store.ts` recall path gets wrapped:

```
function recallRelevant(query: string): MemoryEntry[] {
  // Phase 1: Try vector search (with 500ms timeout)
  const vector = await embedder.embed(query, 500)
  if (vector) {
    const results = await vectorStore.search(vector)
    if (results.length > 0) return results
  }

  // Phase 2: TF-IDF fallback (existing, <1ms)
  return tfidfRecall(query)
}
```

### Migration

Existing `memory.jsonl` entries are re-indexed on first run after upgrade. A migration flag in `.pandaclaw/metadata.json` ensures it runs once.

### Testing

- Unit test embedder: can load model and produce deterministic vectors
- Unit test vector store: insert → search → verify closest matches
- Integration test: end-to-end recall with both vector path and TF-IDF fallback
- Benchmark: recall latency under various sizes (100, 1K, 10K entries)

---

## 4. Prompt Injection Defense

### Problem

Any channel user can invoke any tool. In a multi-user gateway (Telegram group, shared WebChat), there's no guard against prompt injection or malicious tool use.

### Design

Two-layer system: static risk levels + dynamic config overrides.

### Layer 1: Risk Levels

Every tool in `tools/index.ts` gets a `riskLevel`:

```typescript
interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: any, context?: ToolContext) => Promise<any>
  riskLevel?: "safe" | "ask" | "deny"  // default: "safe"
}
```

Default levels:

| Tool | Risk Level | Reason |
|---|---|---|
| `file_read` | safe | Read-only |
| `list_dir` | safe | Read-only |
| `web_search` | safe | Read-only (external) |
| `web_fetch` | safe | Read-only (external) |
| `memory_recall` | safe | Read-only |
| `file_write` | ask | Destructive |
| `code_exec` | ask | Full system access |
| `app_control` | ask | OS-level changes |
| `alarm_set` | ask | System modification |

### Layer 2: Config Overrides

```json
{
  "security": {
    "cli": {
      "code_exec": "ask"
    },
    "telegram": {
      "code_exec": "deny",
      "file_write": "deny",
      "alarm_set": "deny"
    },
    "webchat": {
      "code_exec": "deny"
    }
  }
}
```

Config uses the platform name from `ChannelAdapter.platform`. A special `"default"` section applies to all unlisted platforms.

### Implementation

A `SecurityGuard` class wraps tool execution:

```typescript
class SecurityGuard {
  constructor(private config: SecurityConfig) {}

  async check(tool: string, platform: string, context: ToolContext): Promise<SecurityDecision> {
    const level = this.effectiveLevel(tool, platform)
    
    switch (level) {
      case "safe":
        return { allowed: true }
      case "deny":
        return {
          allowed: false,
          reason: `Tool '${tool}' is not allowed on ${platform}.`
        }
      case "ask":
        // In CLI: prompt user. In gateway: send confirmation request.
        const approved = await this.requestConfirmation(tool, context)
        return approved ? { allowed: true } : { allowed: false, reason: "Rejected by user" }
    }
  }

  private effectiveLevel(tool: string, platform: string): RiskLevel {
    return this.config[platform]?.[tool] ?? this.config.default?.[tool] ?? getDefaultRiskLevel(tool)
  }
}
```

### Inline UX

- **CLI mode**: `[y/N]` prompt with tool name and arguments shown
- **Telegram**: Inline keyboard with Approve/Deny buttons
- **WebChat**: Confirmation dialog in the UI
- **Headless/Daemon**: Auto-deny with logged reason

### Audit

Every security decision is logged to `.pandaclaw/audit.jsonl`:

```json
{
  "timestamp": "...",
  "event": "security_check",
  "tool": "code_exec",
  "platform": "telegram",
  "decision": "deny",
  "reason": "Tool 'code_exec' is not allowed on telegram"
}
```

### Testing

- Unit test: safe tool auto-approved, denied tool blocked, ask tool returns confirmation
- Unit test: config overrides take precedence over defaults
- Integration test: end-to-end tool call with security layer in the loop

---

## Implementation Order

| Wave | Components | Rationale |
|---|---|---|
| 1 | SecurityGuard + risk levels | Fastest win, touches only `tools/index.ts` |
| 2 | ChannelAdapter interface | Refactoring only, no behavior change |
| 3 | MCP protocol + host | Unlocks MCP ecosystem |
| 4 | MCP server | Lets other agents use PandaClaw's tools |
| 5 | Embedder + vector store | Largest change, depends on model download |

Each wave is independently shippable and testable.

---

## File Changes Summary

```
NEW  modes/gateway/channel-adapter.ts    (interface + types)
EDIT modes/gateway/index.ts              (use ChannelAdapter)
EDIT modes/gateway/adapters/*.ts         (implement ChannelAdapter)

NEW  mcp/protocol.ts                     (JSON-RPC types + transport)
NEW  mcp/host.ts                         (connect to MCP servers)
NEW  mcp/server.ts                       (expose tools as MCP server)
EDIT ai/ai.config.ts                     (MCP server config)

NEW  memory/embedder.ts                  (@xenova/transformers wrapper)
NEW  memory/vector-store.ts              (sqlite-vec CRUD)
NEW  memory/memory.ts                    (orchestrator: vector→TF-IDF)
EDIT memory/store.ts                     (use new recall path)

NEW  tools/security-guard.ts             (risk level + config check)
EDIT tools/index.ts                      (wrap execute with security)
EDIT index.ts                            (load security config)
EDIT .fallowrc.json / schema             (add security config keys)
```
