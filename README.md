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

**PandaClaw** is a CLI AI assistant built on Bun — with file access, shell execution, web search, memory recall, app control, multi-provider fallback, streaming responses, and a web dashboard.

---

## 📦 Installation

You can install PandaClaw using one of the three options below:

### Option 1: Automated Script (Recommended)

This script checks for/installs Bun, clones the repository, registers the executable globally, and initializes your configuration:

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
# Interactive setup wizard
pandaclaw setup
```

Or create `config.json`:

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
- `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `NVIDIA_NIM_KEY`
- `OLLAMA_API_BASE` / `TELEGRAM_TOKEN`

---

## 🎮 Usage

```bash
pandaclaw ask          # Interactive ask mode (3 routes)
pandaclaw agent        # Autonomous swarm for multi-step goals
pandaclaw plan         # Goal → plan → execute with per-step approval
pandaclaw dashboard    # Web dashboard (port 18789)
pandaclaw setup        # Configure API keys and providers
pandaclaw sessions     # List, switch, manage agent sessions
pandaclaw wakeup       # Welcome menu
```

Or via bun scripts:

```bash
bun run ask            # Interactive ask mode
bun run dashboard      # Web dashboard
bun run setup          # Configuration wizard
bun run typecheck      # TypeScript type check
bun test               # Run test suite (93 tests)
```

---

## 🐼 Ask Mode — 3 Route Classifier

The `ask` mode classifies every input into one of three routes:

| Route | When | What happens |
| :--- | :--- | :--- |
| **simple** | Greetings, quick facts | Direct LLM call via Groq (`llama-3.3-70b`), no tools |
| **complex** | Hard reasoning questions | DeepSeek R1 reasoning + verification loop via OpenRouter |
| **action** | File ops, shell, web search, app control | Tool agent with full tool access and streaming output |

The tool agent chains across 4 providers with automatic fallback:

```
groq_70b → openrouter_qwen3_coder → nvidia_nim → ollama
```

If a provider rate-limits (429), times out, or fails, the next provider in the chain is tried silently. Small-context models (`llama-3.1-8b-instant`, `qwen3:0.6b`) are skipped automatically when tool schemas exceed their context window.

---

## 🛠️ Tools

The tool agent has full access to the device via these tools:

| Tool | Description |
| :--- | :--- |
| `file_read` | Read any file (absolute paths) |
| `file_write` | Write or create any file (auto-creates parent dirs) |
| `list_dir` | List files in a directory (optionally recursive) |
| `code_exec` | Execute any shell command |
| `web_search` | Search the web (Tavily API + DuckDuckGo fallback) |
| `memory_recall` | Recall past conversations and facts via TF-IDF |
| `app_control` | Control macOS apps — Chrome/Safari, YouTube, system settings, volume, brightness, clipboard, keyboard input |
| `canvas_control` | Draw shapes or render HTML on the web dashboard |
| `alarm_set` | Set macOS/Linux alarms with system notifications |

### App Control Actions

The `app_control` tool covers:

- **Chrome** — open URLs, search
- **Safari** — open URLs
- **YouTube** — resolve latest video from a channel
- **System** — launch VS Code, start/stop services, adjust volume/brightness (0-100), clipboard read/write, screenshot
- **Browser actions** — scroll, navigate (back/forward/refresh/close), list tabs, switch tabs (by index or title)
- **Keyboard** — type text, press keys with modifiers (cmd, option, shift, etc.)

---

## 💬 Streaming Output

All tool agent responses stream progressively with a typing effect:

```
You: what is python

  🐼 action mode · 810ms · tool-agent · tools: memory_recall

PandaClaw: Python is a high-level, general-purpose programming language...
```

- Tool progress is shown inline (searching, reading files, etc.)
- Final answer streams word-by-word in real-time
- Stats badge shows mode, duration, provider, and tools used

---

## 🧠 Memory System

PandaClaw persists conversation context across sessions:

- **Chat history** — per-conversation JSONL logs at `.pandaclaw/chats.jsonl`. Keeps last 10 turns in prompt context.
- **TF-IDF semantic recall** — `recallRelevant()` matches past entries via keyword scoring in < 1ms, zero API cost.
- **Knowledge graph** — triplet relations (subject → predicate → object) stored at `.pandaclaw/graph_memory.json`. Auto-synced to `.pandaclaw/KNOWLEDGE_GRAPH.md`.
- **Background compaction** — when history exceeds 12 turns, oldest 4 turns are pruned and summarized into `.pandaclaw/COMPACTED_MEMORY.md`.
- **Persistence** — user and assistant messages saved to memory on every turn.

---

## 🖥️ Web Dashboard

```bash
pandaclaw dashboard
# or
bun run dashboard
```

Serves a glassmorphic dashboard at `http://localhost:18789` with:
- Real-time chat interface with streaming responses
- Visual canvas for agent drawings (rectangles, HTML cards)
- Live WebSocket logs
- Dark/light theme toggle

---

## 🔌 Multi-Provider Fallback

| Provider | Model | Role |
| :--- | :--- | :--- |
| Groq | `llama-3.3-70b-versatile` | Primary tool-calling provider |
| OpenRouter | `qwen/qwen3-coder:free` | Fallback when Groq is rate-limited |
| Nvidia NIM | `meta/llama-3.3-70b-instruct` | Second fallback |
| Ollama | `qwen3:0.6b` | Local fallback for offline use |

---

## 📁 Project Layout

```
pandaclaw/
├── index.ts                  # CLI entrypoint (Commander)
├── config.json               # Provider and tool config
├── ai/
│   ├── ai.config.ts          # Config parser with env overrides
│   ├── config-schema.ts      # Zod validation schema
│   ├── llm.ts                # Unified callLLM with streaming + response cache
│   ├── context-compressor.ts # Token compression utilities
│   ├── response-cache.ts     # TF-IDF semantic cache (0.92 threshold)
│   └── providers/            # Groq, OpenRouter, Nvidia, Ollama adapters
├── modes/
│   ├── ask/                  # Ask mode — classifier, tool agent, fast path, panda mode
│   │   ├── orchestrator.ts   # CLI loop with streaming output
│   │   ├── tool-agent.ts     # Agentic tool-calling loop (LLM + tool execution)
│   │   ├── classifier.ts     # 3-route classifier (simple/complex/action)
│   │   ├── fast-path.ts      # Simple LLM call without tools
│   │   └── panda-mode.ts     # DeepSeek R1 reasoning + verification
│   ├── agent/                # Autonomous agent mode (reactor loop, swarm coordinator)
│   ├── plan/                 # Strategic plan mode (goal → plan → execute)
│   └── gateway/              # Telegram / Slack / webchat channel adapters
├── tools/                    # Tool registry
│   ├── index.ts              # Tool registration and execution router
│   ├── web-search.ts         # Tavily + DuckDuckGo search
│   ├── web-fetch.ts          # URL content fetcher
│   ├── file-tools.ts         # File read/write/list operations
│   ├── code-exec.ts          # Shell command execution
│   ├── canvas-tools.ts       # Canvas drawing interface
│   ├── apps/                 # App control (Chrome, Safari, YouTube, system, keyboard)
│   ├── dynamic-loader.ts     # Skill loader for /skills folder
│   └── code-formatter.ts     # Auto-detect formatter (Biome, Prettier, ESLint)
├── memory/
│   ├── store.ts              # Chat history, TF-IDF recall, graph relations, pruning
│   └── consolidator.ts       # Background memory compaction
├── canvas/                   # Web dashboard (Bun.serve, port 18789)
│   ├── server.ts             # Bun.serve with SSE streaming + WebSocket logs
│   ├── index.html            # Dashboard HTML
│   └── public/               # Frontend JS/CSS
├── vision/                   # 4-stage vision pipeline (Perceive → Locate → Reason → Act)
├── tui/                      # Terminal UI
│   ├── wakeup.ts             # Welcome menu (figlet ASCII art)
│   ├── setup.ts              # Interactive config wizard
│   └── process-lock.ts       # PID file lock for single instance
├── tests/                    # 93 unit tests across 17 files
│   ├── ask.test.ts           # Classifier + AskOrchestrator tests
│   ├── config-schema.test.ts # Config validation tests
│   ├── session-manager.test.ts
│   ├── swarm.test.ts
│   ├── memory-consolidator.test.ts
│   └── logger.test.ts
├── utils/
│   └── logger.ts             # Structured JSONL logger
├── types/
│   └── shared.ts             # Shared type definitions
└── skills/                   # User-defined pluggable tools (loaded at startup)
```

---

## 🧪 Testing

```bash
bun test                    # Run all 93 tests
bun test --watch            # Watch mode
bun run typecheck           # TypeScript type check (tsc --noEmit)
```

---

## 📜 License

MIT
