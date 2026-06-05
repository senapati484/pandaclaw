# 🐼 PandaClaw

<p align="center">
  <img width="1594" height="329" alt="pandaclaw" src="https://github.com/user-attachments/assets/c7945125-8f33-435a-9913-aafaf1113351" />
</p>

<p align="center">
  <strong>Slow is smooth. Smooth is perfect.</strong>
</p>

<p align="center">
  🌐 <strong><a href="https://pandaclaw.vercel.app">pandaclaw.vercel.app</a></strong> &nbsp;|&nbsp; 📦 <strong><a href="https://www.npmjs.com/package/pandaclaw">npm Registry</a></strong>
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-%E2%89%A5%201.3.3-black?style=for-the-badge&logo=bun" alt="Bun version"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-v5-blue?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://groq.com/"><img src="https://img.shields.io/badge/GroQ-Llama%203.3-orange?style=for-the-badge" alt="GroQ"></a>
  <a href="https://openrouter.ai/"><img src="https://img.shields.io/badge/OpenRouter-Qwen%203-deepskyblue?style=for-the-badge" alt="OpenRouter"></a>
  <a href="https://www.npmjs.com/package/pandaclaw"><img src="https://img.shields.io/npm/v/pandaclaw?style=for-the-badge&logo=npm&color=red" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License"></a>
</p>

---

**PandaClaw** is a deliberate, reasoning-first CLI AI assistant built on Bun. It gives an LLM full access to your machine — files, shell, web search, app control, memory — while routing every query through a 3-way classifier to pick the right strategy. It also exposes a multi-channel **Gateway** (Telegram, Slack, WebChat) and an autonomous **Agent mode** with a swarm coordinator and full session persistence.

---

## 📦 Installation

### Option 1: Automated Script (Recommended)

Checks for/installs Bun, clones the repo, registers the executable globally, and initialises your config:

```bash
curl -fsSL https://raw.githubusercontent.com/senapati484/pandaclaw/main/install.sh | bash
```

### Option 2: via npm / Bun

```bash
# Global install using Bun (native runtime)
bun install -g pandaclaw

# Or global install using npm
npm install -g pandaclaw
```

### Option 3: Manual Clone (Development)

```bash
git clone https://github.com/senapati484/pandaclaw
cd pandaclaw
bun install
npm install -g .
```

---

## ⚙️ Configuration

```bash
pandaclaw setup        # Interactive setup wizard
```

Or create `config.json` manually:

```json
{
  "providers": {
    "groq": {
      "api_key": "gsk_...",
      "api_base": "https://api.groq.com/openai/v1"
    },
    "openrouter": {
      "api_key": "sk-or-...",
      "api_base": "https://openrouter.ai/api/v1"
    },
    "nvidia_nim": {
      "api_key": "nvapi-...",
      "api_base": "https://integrate.api.nvidia.com/v1"
    },
    "ollama": {
      "api_key": "ollama",
      "api_base": "http://127.0.0.1:11434/v1"
    }
  }
}
```

Environment variables override `config.json`:

| Variable | Purpose |
| :--- | :--- |
| `GROQ_API_KEY` | Groq API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `NVIDIA_NIM_KEY` | Nvidia NIM API key |
| `OLLAMA_API_BASE` | Ollama base URL |
| `TELEGRAM_TOKEN` | Telegram bot token (Gateway) |

---

## 🎮 Usage

```bash
pandaclaw ask          # Quick answers, file ops, and shell commands (3-route classifier)
pandaclaw agent        # Autonomous reactor loop with swarm support
pandaclaw plan         # Decompose, optimize, and execute goals step-by-step
pandaclaw dashboard    # Start the Visual Canvas Web Dashboard (port 18789)
pandaclaw setup        # Configure API keys and providers interactively
pandaclaw daemon       # Manage background daemon service (start, stop, status, logs)
pandaclaw sessions     # List, switch, show, and delete agent sessions
pandaclaw cost         # Show persistent token consumption and cost analysis
pandaclaw schedule     # Manage heartbeat schedules (list, add, run, pause, history)
pandaclaw workspace    # Create, list, switch, and delete named workspaces
pandaclaw skills       # Browse and install custom skills from marketplace
pandaclaw webhook      # Manage incoming webhook configurations (add, list, remove)
pandaclaw wakeup       # Launch the interactive welcome menu
```

Via `bun` scripts directly:

```bash
bun run ask            # Interactive ask mode
bun run dashboard      # Web dashboard
bun run setup          # Configuration wizard
bun run typecheck      # TypeScript type check (tsc --noEmit)
bun test               # Run all 110 tests
```

---

## 🐼 Ask Mode — 3-Route Classifier

Every input is classified into one of three routes before the LLM is called:

| Route | Triggered by | What runs |
| :--- | :--- | :--- |
| **simple** | Greetings, quick facts | Direct LLM call via Groq (`llama-3.3-70b`) — no tools, lowest latency |
| **complex** | Hard reasoning, analysis | DeepSeek R1 reasoning via OpenRouter + verification loop |
| **action** | File ops, shell, search, app control | Full tool agent with streaming output and multi-provider fallback |

The tool agent automatically chains across providers if one fails or rate-limits:

```
groq_70b → openrouter_qwen3_coder → nvidia_nim → ollama
```

Small-context models (`llama-3.1-8b-instant`, `qwen3:0.6b`) are skipped automatically when tool schemas exceed their context window. If a provider returns 429, times out (30s stream / 15s non-stream), or errors, the next provider is tried silently with no disruption to the user.

---

## 🛠️ Tools

The tool agent has full access to the device via 9 built-in tools:

| Tool | Description |
| :--- | :--- |
| `file_read` | Read any file (absolute paths) |
| `file_write` | Write or create any file (auto-creates parent directories) |
| `list_dir` | List files in a directory, optionally recursive |
| `code_exec` | Execute any shell command with configurable timeout |
| `web_search` | Search the web (Tavily API with DuckDuckGo fallback) |
| `memory_recall` | Recall past conversations and facts via TF-IDF scoring |
| `app_control` | Control macOS apps, system settings, browsers, and keyboard |
| `canvas_control` | Draw shapes or render HTML on the web dashboard canvas |
| `alarm_set` | Set macOS/Linux system alarms and reminders |

### `app_control` capabilities

- **Chrome / Safari** — open URLs, search
- **YouTube** — resolve latest video from any channel
- **System** — launch VS Code, start/stop services, volume (0-100), brightness (0-100), clipboard read/write
- **Browser actions** — scroll (up/down/top/bottom), navigate (back/forward/refresh/close tab), list tabs, switch tabs by index or title
- **Keyboard** — type text, press keys with modifiers (`cmd`, `option`, `shift`, `ctrl`)

### Dynamic Skills

Place a `.ts` or `.js` file in the `skills/` folder and PandaClaw loads it at startup — no restart required. Skills can expose custom tools and schemas that become immediately available to the tool agent.

---

## 💬 Streaming Output

All tool agent responses stream progressively:

```
You: list all files in the project

  🐼 action mode · 1102ms · tool-agent · tools: list_dir

PandaClaw: Here are the files in your project...
```

- Tool calls show inline progress (searching, reading, executing…)
- Final answer streams token-by-token in real time
- Stats badge shows: mode, duration, provider, tools used

---

## 🤖 Agent Mode — Reactor Loop + Swarm

`pandaclaw agent` launches the **Autonomous Agent** which runs a continuous **Observe → Reason → Plan → Execute → Reflect** reactor loop:

| Component | Role |
| :--- | :--- |
| `ActionTracker` | Logs every action (pending → executing → completed/failed) |
| `ActionPlanner` | Decomposes goals into typed mutations (create / modify / delete) |
| `MutationExecutor` | Applies file mutations and shell commands with risk assessment |
| `ReflectionEngine` | Validates each mutation and updates session memory |
| `SessionMemoryManager` | Tracks constraints, error patterns, and success patterns |
| `ActionHistory` | Snapshot-based undo/redo for every file mutation |
| `SwarmCoordinator` | Distributes sub-tasks across parallel `SwarmWorker` instances |
| `CodebaseContextManager` | Builds semantic understanding of the project before acting |
| `ModelSelector` | Picks the optimal model (fast/balanced/reasoning) per task type |

Sessions are fully persistent — you can resume any past session, view its action history, and undo individual mutations.

---

## 📡 Plan Mode

`pandaclaw plan` breaks a high-level goal into an executable task graph:

1. **Decompose** — `PlanGenerator` splits the goal into typed steps with dependencies
2. **Validate** — `PlanValidator` checks for circular dependencies and missing steps
3. **Optimise** — `PlanOptimizer` computes the topological execution order and critical path
4. **Execute** — `PlanExecutor` runs each step with per-step approval prompts

---

## 🌐 Gateway — Telegram · Slack · WebChat

`pandaclaw` includes a multi-channel gateway that routes messages from external platforms through the same 3-way classifier and tool agent:

```bash
pandaclaw wakeup       # Choose "Telegram Bot" to start the Telegram Gateway
# OR
pandaclaw dashboard    # Start WebChat & Slack Gateway with visual web dashboard
```

| Channel | Setup |
| :--- | :--- |
| **Telegram** | Set `TELEGRAM_TOKEN` — bot responds to `/start`, `/help`, `/status`, and all messages |
| **Slack** | Set webhook URL in config — incoming webhooks supported |
| **WebChat** | Built into the dashboard at `http://localhost:18789` |

The `/status` command dynamically lists all configured providers and their connection status.

**Vision support:** Send any image to the Telegram bot and it runs the 4-stage vision pipeline (Perceive → Locate → Reason → Act), returning structured analysis — describe, diagnose, navigate, code review, or extract.

---

## 🧠 Memory System

PandaClaw persists conversation context across sessions with no external database:

| Layer | Detail |
| :--- | :--- |
| **Chat history** | Per-conversation JSONL logs at `.pandaclaw/chats.jsonl`. Last 10 turns injected into every prompt |
| **TF-IDF recall** | `recallRelevant()` scores past entries by keyword overlap in < 1ms, zero API cost |
| **Knowledge graph** | Subject → predicate → object triplets at `.pandaclaw/graph_memory.json`, auto-synced to `.pandaclaw/KNOWLEDGE_GRAPH.md` |
| **Background compaction** | When history exceeds 12 turns, oldest 4 turns are summarised into `.pandaclaw/COMPACTED_MEMORY.md` |
| **Response cache** | TF-IDF semantic cache with 0.92 similarity threshold — repeated questions answered instantly |

---

## 🖥️ Web Dashboard

```bash
pandaclaw dashboard
# → http://localhost:18789
```

Glassmorphic dark dashboard with:
- Real-time streaming chat interface
- Visual canvas for agent drawings (rectangles, HTML cards)
- Live WebSocket debug logs
- Dark/light theme toggle

---

## 🔌 Multi-Provider Fallback

| Provider | Model | Role |
| :--- | :--- | :--- |
| Groq | `llama-3.3-70b-versatile` | Primary — fastest tool-calling |
| OpenRouter | `qwen/qwen3-coder:free` | Fallback when Groq rate-limits |
| Nvidia NIM | `meta/llama-3.3-70b-instruct` | Second fallback |
| Ollama | `qwen3:0.6b` | Local fallback for offline use |

All provider calls use a shared `withTimeout` helper — 30s for streaming, 15s for non-streaming — with clean abort on timeout and automatic next-provider retry.

---

## 👁️ Vision Pipeline

Send any image (via Telegram bot or dashboard) and PandaClaw runs a 4-stage pipeline:

```
Perceive → Locate → Reason → Act
```

Output is classified into one of five action types: `describe`, `diagnose`, `navigate`, `code_review`, or `extract`.

---

## 📁 Project Layout

```
pandaclaw/
├── index.ts                        # CLI entrypoint (Commander)
├── config.json                     # Provider and tool configuration
├── ai/
│   ├── ai.config.ts                # Config parser with env overrides
│   ├── config-schema.ts            # Zod validation schema
│   ├── config-loader.ts            # Config file loader
│   ├── config-overrides.ts         # Environment variable overrides
│   ├── llm.ts                      # Unified callLLM — streaming, cache, withTimeout fallback
│   ├── context-compressor.ts       # Token compression utilities
│   ├── response-cache.ts           # TF-IDF semantic cache (0.92 threshold)
│   └── providers/
│       ├── adapter.ts              # Provider interface
│       ├── groq-adapter.ts         # Groq (Llama 3.3 70B)
│       ├── openrouter-adapter.ts   # OpenRouter (Qwen3 Coder)
│       ├── nvidia-adapter.ts       # Nvidia NIM
│       ├── ollama-adapter.ts       # Ollama (local)
│       ├── stream-adapter.ts       # OpenAI-compatible SSE streaming
│       └── llm-utils.ts            # Message sanitiser, fetchWithRetry
├── modes/
│   ├── cli.ts                      # Commander CLI definitions
│   ├── ask/
│   │   ├── orchestrator.ts         # CLI loop with streaming output + stats badge
│   │   ├── classifier.ts           # 3-route classifier (simple / complex / action)
│   │   ├── tool-agent.ts           # Agentic tool-calling loop
│   │   ├── tool-schemas.ts         # OpenAI-compatible tool schema definitions
│   │   ├── fast-path.ts            # Simple route — direct LLM call, no tools
│   │   └── panda-mode.ts           # Complex route — DeepSeek R1 reasoning
│   ├── agent/
│   │   ├── orchestrator.ts         # Reactor loop (Observe→Reason→Plan→Execute→Reflect)
│   │   ├── action-tracker.ts       # Action lifecycle logging
│   │   ├── action-history.ts       # Snapshot-based undo/redo
│   │   ├── action-planner.ts       # Goal → typed mutation plan
│   │   ├── mutation-executor.ts    # File and shell mutation executor
│   │   ├── reflection-engine.ts    # Post-mutation validation
│   │   ├── session-manager.ts      # Session CRUD and persistence
│   │   ├── session-memory.ts       # Constraints, error/success patterns
│   │   ├── context-manager.ts      # Codebase semantic context
│   │   ├── model-selector.ts       # Task-type → model mapping
│   │   ├── test-runner.ts          # Run tests for changed files
│   │   ├── types.ts                # Agent type definitions
│   │   └── swarm/
│   │       ├── coordinator.ts      # Parallel task distribution
│   │       ├── worker.ts           # Individual swarm worker
│   │       └── types.ts            # Swarm type definitions
│   ├── plan/
│   │   ├── orchestrator.ts         # Plan mode CLI loop
│   │   ├── plan-generator.ts       # Goal decomposition
│   │   ├── plan-validator.ts       # Dependency and cycle checking
│   │   ├── plan-optimizer.ts       # Topological sort + critical path
│   │   ├── plan-executor.ts        # Step-by-step execution with approval
│   │   └── types.ts                # Plan type definitions
│   └── gateway/
│       ├── adapter.ts              # ChannelAdapter interface
│       ├── index.ts                # Gateway router and message handler
│       └── adapters/
│           ├── telegram.ts         # Telegram Bot API adapter
│           ├── slack.ts            # Slack webhook adapter
│           └── webchat.ts          # WebChat (dashboard) adapter
├── tools/
│   ├── index.ts                    # Tool registry and execution router
│   ├── file-tools.ts               # file_read / file_write / list_dir
│   ├── code-exec.ts                # Shell command execution
│   ├── web-search.ts               # Tavily + DuckDuckGo fallback
│   ├── web-fetch.ts                # URL content fetcher
│   ├── canvas-tools.ts             # canvas_control (draw, render HTML)
│   ├── code-formatter.ts           # Auto-detect Biome / Prettier / ESLint
│   ├── dynamic-loader.ts           # Load custom tools from skills/ at startup
│   └── apps/
│       ├── index.ts                # app_control router
│       ├── chrome.ts               # Chrome control (AppleScript)
│       ├── safari.ts               # Safari control
│       ├── youtube.ts              # YouTube channel → latest video
│       ├── system.ts               # Volume, brightness, VS Code, services
│       ├── browser-actions.ts      # Scroll, tabs, navigate
│       ├── keyboard.ts             # Type text, key combos
│       └── utils.ts                # Shared AppleScript / PowerShell utilities
├── memory/
│   ├── store.ts                    # Chat history, TF-IDF recall, graph relations, pruning
│   └── consolidator.ts             # Background memory compaction
├── canvas/
│   └── server.ts                   # Bun.serve — SSE streaming + WebSocket dashboard
├── vision/
│   ├── index.ts                    # 4-stage pipeline entry point
│   ├── perceive.ts                 # Stage 1: image decoding and classification
│   ├── reason.ts                   # Stage 2-3: localise + reason
│   └── act.ts                      # Stage 4: structured action output
├── tui/
│   ├── wakeup.ts                   # Welcome menu (figlet ASCII art)
│   └── setup.ts                    # Interactive config wizard
├── utils/
│   ├── logger.ts                   # Structured JSONL logger with levels
│   ├── terminal-ui.ts              # stripAnsi / wrapLine / drawBox helpers
│   ├── path.ts                     # Path resolution utilities
│   ├── paths.ts                    # Workspace paths resolver (circular dep breaker)
│   ├── cost-tracker.ts             # Token cost tracker and estimator
│   ├── heartbeat.ts                # Heartbeat cron scheduler engine
│   └── process-lock.ts             # PID file lock (single instance guard)
├── types/
│   └── shared.ts                   # Shared type definitions
├── tests/                          # 110 unit tests across 21 files (including inline mode tests)
│   ├── swarm.test.ts
│   ├── session-manager.test.ts
│   ├── provider-adapter.test.ts
│   ├── config-schema.test.ts
│   ├── compaction.test.ts
│   ├── pandagraph.test.ts
│   ├── code-exec.test.ts
│   ├── memory-consolidator.test.ts
│   ├── gateway.test.ts
│   ├── dynamic-loader.test.ts
│   ├── app-control.test.ts
│   ├── logger.test.ts
│   ├── cost-tracker.test.ts
│   ├── heartbeat.test.ts
│   ├── daemon.test.ts
│   ├── webhook.test.ts
│   ├── workspace.test.ts
│   └── skills.test.ts
└── skills/                         # Drop .ts/.js files here — auto-loaded at startup
```

---

## 🧪 Testing

```bash
bun test                    # Run all 110 tests across 21 files
bun test --watch            # Watch mode
bun test --verbose          # Show each test name and duration
bun run typecheck           # TypeScript type check (tsc --noEmit)
bunx fallow                 # Code quality audit (dead code, duplication, complexity)
```

Current metrics: **110 tests passing · 0 TypeScript errors · MI 90.7 (good) · 0 dead exports**

---

## 📜 License

[MIT](LICENSE) — Copyright (c) 2025 senapati484
