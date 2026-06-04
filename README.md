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

## Quick Start

```bash
# Install
git clone https://github.com/senapati484/pandaclaw
cd pandaclaw
bun install

# Configure API keys
cp .env.example .env   # or run: bun run setup

# Run
bun run ask            # Interactive ask mode
```

## Usage

```bash
pandaclaw ask          # Ask questions, run commands, control apps
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
bun run typecheck      # TypeScript check
bun test               # Run test suite (93 tests)
```

## Ask Mode — 3 Routes

The `ask` mode classifies your input into one of three routes:

| Route | When | What happens |
| :--- | :--- | :--- |
| **simple** | Greetings, quick facts | Direct LLM call (Groq fast-path) |
| **complex** | Hard reasoning questions | DeepSeek R1 + verification loop |
| **action** | File ops, shell commands, web search, app control | Tool agent with web search, memory recall, file access, shell, app control |

The tool agent chains across 4 providers with automatic fallback:

```
groq_70b → openrouter_qwen3_coder → nvidia_nim → ollama
```

## Tools

| Tool | What it does |
| :--- | :--- |
| `file_read` / `file_write` / `list_dir` | File system access (absolute paths) |
| `code_exec` | Shell command execution |
| `web_search` | Tavily API + DuckDuckGo fallback |
| `memory_recall` | Search past conversations (TF-IDF) |
| `app_control` | Launch apps, browser control, volume/brightness, keyboard input |
| `canvas_control` | Draw shapes / render HTML on the web dashboard |
| `alarm_set` | macOS / Linux alarms with system notifications |

## Configuration

```json
{
  "providers": {
    "groq": { "api_key": "gsk_...", "api_base": "https://api.groq.com/openai/v1" },
    "openrouter": { "api_key": "sk-or-...", "api_base": "https://openrouter.ai/api/v1" },
    "nvidia_nim": { "api_key": "nvapi-...", "api_base": "https://integrate.api.nvidia.com/v1" },
    "ollama": { "api_key": "ollama", "api_base": "http://127.0.0.1:11434/v1" }
  }
}
```

Environment variables override config values: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_NIM_KEY`, `TELEGRAM_TOKEN`.

## Project Layout

```
pandaclaw/
├── index.ts                  # CLI entrypoint (Commander)
├── config.json               # Provider and tool config
├── ai/
│   ├── ai.config.ts          # Config parser with env overrides
│   ├── config-schema.ts      # Zod validation schema
│   ├── llm.ts                # Unified callLLM with streaming + response cache
│   ├── context-compressor.ts # Token compression utilities
│   ├── response-cache.ts     # TF-IDF semantic cache
│   └── providers/            # Groq, OpenRouter, Nvidia, Ollama adapters
├── modes/
│   ├── ask/                  # Ask mode (classifier, tool agent, fast path, panda mode)
│   │   ├── orchestrator.ts   # CLI loop with streaming
│   │   ├── tool-agent.ts     # Agentic tool-calling loop
│   │   ├── classifier.ts     # 3-route classifier
│   │   ├── fast-path.ts      # Simple LLM call
│   │   └── panda-mode.ts     # DeepSeek R1 reasoning
│   ├── agent/                # Autonomous agent mode (reactor loop, swarm)
│   ├── plan/                 # Strategic plan mode
│   └── gateway/              # Telegram / Slack / webchat adapters
├── tools/                    # Tool registry (web search, file ops, app control, canvas)
├── memory/
│   ├── store.ts              # Chat history, TF-IDF recall, graph relations
│   └── consolidator.ts       # Background memory compaction
├── canvas/                   # Web dashboard (Bun.serve, port 18789)
├── vision/                   # 4-stage vision pipeline (Perceive → Locate → Reason → Act)
├── tui/                      # Setup wizard, wakeup menu
├── tests/                    # 93 unit tests
└── skills/                   # User-defined pluggable tools
```

## Memory

- **Chat history** — per-conversation JSONL logs with auto-pruning (keeps last 10 turns)
- **TF-IDF recall** — keyword relevance matching via `recallRelevant()` in `< 1ms`
- **Knowledge graph** — triplet relations (subject/predicate/object) extracted from conversations
- **Background compaction** — oldest 4 turns compacted into summary facts every 12 turns

## License

MIT
