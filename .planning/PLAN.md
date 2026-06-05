# Phase 1 Implementation Plan

**Design doc:** `docs/superpowers/specs/2026-06-05-pandaclaw-phase1-design.md`
**Milestone:** Core Competitiveness — MCP, Security, RAG, Channel Interface
**Strategy:** 5 waves, independently shippable + testable

---

## Wave 1: Prompt Injection Defense (~2h)

**Goal:** Every tool call passes through a security gate. No tool can be invoked without policy check.

### Tasks

| # | Task | Effort | Files | Done Criteria |
|---|------|--------|-------|-------------|
| 1.1 | Create `tools/security-guard.ts` — `SecurityGuard` class with risk-level resolution (default → config override) and `check()` method returning `{ allowed, reason }` | 30m | `NEW tools/security-guard.ts` | Unit test: safe auto-approves, deny blocks, ask returns confirmation |
| 1.2 | Add `riskLevel` field to `ToolDefinition` in `tools/index.ts` and assign defaults (file_read=safe, code_exec=ask, etc.) | 10m | `EDIT tools/index.ts` | Every tool has a riskLevel |
| 1.3 | Wrap `runTool()` with `SecurityGuard.check()` — if denied, return blocked message instead of executing | 20m | `EDIT tools/index.ts` | Denied tools never reach execute |
| 1.4 | Build `requestConfirmation()` — CLI gets `[y/N]` prompt, gateway channels get async confirmation via message reply | 30m | `EDIT tools/security-guard.ts` | CLI: y/N works. Gateway: returns pending |
| 1.5 | Add config loading for `security` block in `index.ts` + schema | 20m | `EDIT index.ts` | Config loads, merges with defaults, validates |
| 1.6 | Wire audit logging — every security decision writes to `.pandaclaw/audit.jsonl` | 10m | `EDIT tools/security-guard.ts` | Audit file has correct entries |

**Test:** `bun test tests/security-guard.test.ts` — 5 tests covering safe/ask/deny/config-override/audit

---

## Wave 2: Channel Adapter Interface (~3h)

**Goal:** Telegram, Slack, WebChat implement a shared `ChannelAdapter` interface. Gateway becomes a registry.

### Tasks

| # | Task | Effort | Files | Done Criteria |
|---|------|--------|-------|-------------|
| 2.1 | Create `modes/gateway/channel-adapter.ts` with all types and the `ChannelAdapter` interface | 20m | `NEW modes/gateway/channel-adapter.ts` | Exported types compile clean |
| 2.2 | Refactor `TelegramAdapter` to implement `ChannelAdapter` — wrap existing `initialize` as `start()`, wire `onMessage` to bot.on("message"), add `health()` | 45m | `EDIT modes/gateway/adapters/telegram.ts` | Telegram works exactly as before |
| 2.3 | Refactor `SlackAdapter` to implement `ChannelAdapter` — wrap webhook listener as `start()`, wire `onMessage` to event handler | 30m | `EDIT modes/gateway/adapters/slack.ts` | Slack works exactly as before |
| 2.4 | Refactor `WebChatAdapter` to implement `ChannelAdapter` — SSE init as `start()`, wire `onMessage` to message callback | 30m | `EDIT modes/gateway/adapters/webchat.ts` | WebChat works exactly as before |
| 2.5 | Rewrite `Gateway` class to use `ChannelAdapter` registry — `register()`, `start()`, `stop()`, `broadcast()` | 30m | `EDIT modes/gateway/index.ts` | All existing gateway functionality preserved |
| 2.6 | Update all callers of Gateway to use new API | 15m | `EDIT index.ts`, callers | No type errors |

**Test:** `bun test` — all 50 existing tests pass (no behavior change)

---

## Wave 3: MCP Protocol + Host (~4h)

**Goal:** PandaClaw connects to MCP servers and uses their tools.

### Tasks

| # | Task | Effort | Files | Done Criteria |
|---|------|--------|-------|-------------|
| 3.1 | Create `mcp/protocol.ts` — JSON-RPC 2.0 types, `readMessage()` / `writeMessage()` for line-delimited JSON over stdio | 30m | `NEW mcp/protocol.ts` | Unit test: round-trip message serialization |
| 3.2 | Create `mcp/host.ts` — `MCPHost` class that spawns server processes, discovers tools via `tools/list`, manages lifecycle with reconnect (exponential backoff, 3 retries) | 1.5h | `NEW mcp/host.ts` | Integration test: connects to test MCP server, discovers tools |
| 3.3 | Register discovered MCP tools into PandaClaw's tool registry with `serverName_toolName` prefix | 30m | `EDIT mcp/host.ts`, `EDIT tools/index.ts` | MCP tools appear in tool list alongside built-in |
| 3.4 | Forward tool calls to MCP server via `tools/call` and return results | 30m | `EDIT mcp/host.ts` | Integration test: call tool on test server, get correct result |
| 3.5 | Add MCP server config to `ai/ai.config.ts` + validate schema | 20m | `EDIT ai/ai.config.ts` | Config loads, MCP servers connect on startup |
| 3.6 | Handle server disconnects — graceful degradation (warn + remove tools, retry connection) | 20m | `EDIT mcp/host.ts` | Test: kill server, tools removed, reconnect works |

**Test:** `bun test tests/mcp.test.ts` — 4 tests (protocol framing, host connect, tool call, reconnect)

---

## Wave 4: MCP Server (~3h)

**Goal:** Claude Code, Cursor, Codex can use PandaClaw's tools via MCP.

### Tasks

| # | Task | Effort | Files | Done Criteria |
|---|------|--------|-------|-------------|
| 4.1 | Create `mcp/server.ts` — `MCPServer` class that listens for `tools/list` and `tools/call` | 1h | `NEW mcp/server.ts` | Unit test: responds to tools/list with correct schema |
| 4.2 | Map PandaClaw's `ToolDefinition[]` to MCP tool format (name, description, inputSchema) | 20m | `EDIT mcp/server.ts` | Each tool maps correctly |
| 4.3 | Implement `tools/call` — execute tool via `ToolRegistry` and return result | 30m | `EDIT mcp/server.ts` | Integration test: call tool via MCP, get result |
| 4.4 | Add stdio transport — start MCP server when `mcp.server.enabled` is true | 20m | `EDIT mcp/server.ts` | Claude Code can connect via `mcpServers` config |
| 4.5 | Add SSE transport (optional HTTP server) for remote agent access on configurable port | 30m | `EDIT mcp/server.ts` | Remote server responds to SSE connections |
| 4.6 | Wire MCP server startup into `index.ts` — starts after config loads, stops on shutdown | 20m | `EDIT index.ts` | Server starts/stops cleanly |

**Test:** `bun test tests/mcp-server.test.ts` — 3 tests (tools/list, tools/call, stdio transport)

---

## Wave 5: SQLite-vec RAG (~5h)

**Goal:** Semantic memory recall with local embedding + vector search, fallback to TF-IDF.

### Tasks

| # | Task | Effort | Files | Done Criteria |
|---|------|--------|-------|-------------|
| 5.1 | Add `@xenova/transformers` dependency and create `memory/embedder.ts` — async model loading with timeout, `embed(text)` returns 384-dim vector | 1h | `NEW memory/embedder.ts` | Unit test: embed("hello") returns valid Float32Array[384] |
| 5.2 | Create `memory/vector-store.ts` — `VectorStore` with `bun:sqlite`, `sqlite-vec` extension, `insert()` and `search()` | 1h | `NEW memory/vector-store.ts` | Unit test: insert → search → closest match is correct |
| 5.3 | Create `memory/memory.ts` orchestrator — try vector search (500ms timeout) → fallback TF-IDF | 30m | `NEW memory/memory.ts` | Integration test: vector path works, fallback works when embedder is slow |
| 5.4 | Create migration script — re-index existing `memory.jsonl` entries into vector store. Run once, flagged in `.pandaclaw/metadata.json` | 45m | `NEW memory/migrate.ts` | First run indexes all entries. Second run skips. |
| 5.5 | Replace `store.ts` `recallRelevant()` with new orchestrator | 30m | `EDIT memory/store.ts` | All existing memory consumers use new path transparently |
| 5.6 | Handle model download UX — progress bar on first load, cache model in `~/.pandaclaw/models/`, error gracefully if download fails | 30m | `EDIT memory/embedder.ts` | First run shows download progress. Failed download → TF-IDF fallback silently. |
| 5.7 | Benchmark + tune — test with 100/1K/10K entries, ensure recall stays under 100ms for vector + fallback | 30m | `EDIT memory/` | Benchmark results logged. Tune batch size if needed. |

**Test:** `bun test tests/memory-rag.test.ts` — 5 tests (embedder, vector store, orchestrator, migration, fallback)

---

## Dependency Map

```
Wave 1 (Security)     ── independent ──┐
Wave 2 (Channel API)  ── independent ──┤
Wave 3 (MCP Host)     ── independent ──┼── all can run in parallel
Wave 4 (MCP Server)   ── depends on Wave 3 (protocol.ts) ──┘
Wave 5 (RAG)          ── independent
```

## Total Effort

| Wave | Hours | Complexity | Risk |
|------|-------|------------|------|
| 1. Prompt injection | 2h | Low | Low — isolated, no external deps |
| 2. Channel interface | 3h | Medium | Low — pure refactoring |
| 3. MCP Host | 4h | Medium | Medium — stdio process management |
| 4. MCP Server | 3h | Medium | Low — stdio, no external deps |
| 5. SQLite-vec RAG | 5h | High | Medium — model download, sqlite-vec compat |
| **Total** | **17h** | | |

## Verification

After each wave:
1. `bun test` — all existing tests pass
2. `bun run typecheck` — no type errors
3. Manually test the affected feature path

Final:
4. `pandaclaw ask "hello"` — CLI works through security layer
5. `pandaclaw ask "what files are in this project"` — tool call works through MCP host + security
6. Telegram bot responds with security-gated tool calls
7. Claude Code can connect via MCP server and use PandaClaw tools
8. Memory recall returns semantically relevant results
