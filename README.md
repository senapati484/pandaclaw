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
  <a href="https://groq.com/"><img src="https://img.shields.io/badge/Groq-Llama%203.1%20%26%203.3-orange?style=for-the-badge" alt="Groq Llama 3.1 & 3.3"></a>
  <a href="https://openrouter.ai/"><img src="https://img.shields.io/badge/OpenRouter-Qwen%203%20%2F%20Gemma%204-deepskyblue?style=for-the-badge" alt="OpenRouter Qwen 3 / Gemma 4"></a>
  <a href="https://www.npmjs.com/package/pandaclaw"><img src="https://img.shields.io/npm/v/pandaclaw?style=for-the-badge&logo=npm&color=red" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License"></a>
</p>

---

**PandaClaw** is a *deliberate, reasoning-first, and vision-native personal AI assistant* built on Bun. 

Unlike traditional agents that act instantly, PandaClaw operates with strict planning, multi-agent worker coordination, Git transaction boundaries, a live visual canvas dashboard, and an integrated multi-channel gateway (Telegram, Slack, WebChat) with native voice parsing and macOS alarm utilities.

---

## 🚀 Core Architecture

### 🔒 1. Sandboxing & Git-Backed Rollbacks
*   **Git-Backed Transactions**: All file system mutations run on a temporary git branch (`pandaclaw-tx-<uuid>`). If validation fails or you decline the changes, the workspace is rolled back to its clean commit state instantly.
*   **Bun Process Sandbox**: Arbitrary scripts and command executions are run using a native `Bun.spawn` sandbox with stripped environment secrets (protecting API tokens) and strict timeouts.

### 🐝 2. Coordinator-Worker Swarm
*   **Coordinator**: Main planner that decomposes your high-level goal into a dependency tree of sub-tasks (`SwarmTask`).
*   **Specialized Workers**: Tasks are processed concurrently by specialized agents:
    *   `researcher`: Searches the web, reads codebase files, and gathers facts.
    *   `coder`: Implements logic and creates or modifies source code.
    *   `verifier`: Reviews syntax, runs tests, and sanity checks code.
    *   `visualizer`: Extracts spatial layout elements or builds UI reports.
*   **Reasoning Compiler**: Extracts and parses structured model reasoning (`<think>`) traces (such as Qwen 3 or DeepSeek R1) and applies critique-correction verification loops.

### 🧠 3. PandaGraph Semantic Memory Engine & Active Context Compaction
*   **Persistent Chat History**: Every message (user and assistant) is saved to `.pandaclaw/chats.jsonl` indexed by `chatId`. Conversation history persists seamlessly across gateway restarts!
*   **Knowledge Graph (Triplet Store)**: Semantic facts (user preferences, configurations, constraints, success patterns) are extracted and saved as relationships (`subject`, `predicate`, `object`) inside `.pandaclaw/graph_memory.json`.
*   **Auto-Sync Markdown**: Graph states are automatically formatted into a gorgeous, human-friendly document under **`.pandaclaw/KNOWLEDGE_GRAPH.md`** whenever the graph is modified.
*   **Active Context Compaction**: To prevent prompt token bloat, when the active conversation history exceeds **12 turns**, the oldest **4 turns** are pruned and summarized into key semantic facts, appended to **`.pandaclaw/COMPACTED_MEMORY.md`**, and cleared from the live model context.
*   **TF-IDF Semantic Recall**: An in-process keyword matching and term weight scorer (`recallRelevantRelations`) retrieves facts locally in **< 1ms** with zero API cost, keeping prompt contexts ultra-lean and relevant.
*   **Async Background Consolidation**: Every **3 messages**, the gateway automatically spawns a non-blocking background consolidation task to extract new facts from raw logs and write them to the graph without delaying user chat responses.

### 🔌 4. Pluggable Dynamic Skills Loader
*   **Runtime Custom Plugins**: PandaClaw recursively scans the `skills/` workspace folder at startup.
*   **Automatic Registration**: Any dynamic tool exported from `skills/` files as a `ToolDefinition` is automatically imported and registered, giving the agent customizable capabilities without modifying the core codebase.

### 🎙️ 5. Native Voice & Audio processing
*   **Groq Whisper Integration**: Converts speech buffers (OGG, OPUS, MP3, WAV, MPEG) into text in **< 1 second** using Groq's high-performance `whisper-large-v3` endpoint.
*   **Gateway Adapters Support**: When a voice message is received from a paired Telegram user, the bot automatically downloads, transcribes, previews, and processes it inside the agent pipeline.

### 🎨 6. Local Visual Web Canvas & Agent Drawing
*   Serve a premium glassmorphic dashboard locally on `http://localhost:18789`.
*   **Chat Interface**: Real-time messaging with visual thinking traces.
*   **Visual Canvas**: Real-time canvas overlay rendering bounding box coordinates from the vision locating pipeline.
*   **Interactive Drawing**: The agent uses the `canvas_control` tool to draw rectangles (`draw_rect`), render customized HTML cards (`render_html`), or reset/clear the canvas viewport (`clear_canvas`) dynamically.
*   **Terminal & Diff Viewer**: Live system websocket logs with interactive Accept/Decline approval keys for file mutations.

### ⚡ 7. Pluggable Gateway & Local Ollama Fallback
*   Abstracted channel adapter layer supporting pluggable integrations (`telegram`, `slack`, `webchat`).
*   **Allowed Users Pairing**: Paired Telegram user IDs are stored per-device in `.pandaclaw/paired-users.json` (gitignored), ensuring committed configuration files are never contaminated or leaked.
*   **Local Fallback Chain**: If external LLMs rate limit (429), time out, or fail, the call automatically routes down the fallback chain to a local **Ollama** endpoint (`qwen3:0.6b` model) to maintain continuous runtime operations.
*   **3-Way Classifier**: Routes queries dynamically:
    - `simple`  → snappier direct answering without tools (`runFastPath`) using `llama-3.1-8b-instant`.
    - `complex` → deep reasoning path using the Reasoning Compiler (`runPandaMode`) powered by `qwen/qwen3-coder:free`.
    - `action`  → agentic tool-use loops (`runToolAgent`) with full filesystem/shell access.

### 🕹️ 8. Cross-Platform Full-Device Automation
*   **Dynamic OS Detection**: Automatically adapts parameters and runs native command streams across macOS (`darwin`), Windows (`win32`), and Linux (`linux`).
*   **System & Service Controls**: Launch directories directly in Visual Studio Code, manage background service processes (such as starting/stopping **Ollama** services), adjust audio output **volume** or display **brightness** level sliders, and manage system clipboard operations.
*   **Native macOS Screen Capture**: High-speed, native capture of the desktop via `screencapture -x` integrated under the `app_control` system action suite, supplying images directly to the vision pipeline.
*   **Advanced Web Orchestration**: List all open tabs (Title + URL) across windows, switch or focus tabs dynamically by title matching or index, trigger browser navigations (back, forward, refresh, close), and scroll windows (up, down, top, bottom) in Chrome, Safari (macOS), Microsoft Edge (Windows fallback), or Firefox (Linux fallback).
*   **Simulated Keystrokes & Hotkeys**: Simulates typed strings and hotkey keyboard presses (e.g. `cmd+space` to launch Spotlight) natively using macOS System Events, Windows .NET Forms SendKeys interfaces, and Linux `xdotool` key managers.

---

## 📦 Project Directory Layout

```
pandaclaw/
├── index.ts                    # CLI Entrypoint (Commander, direct ask/agent/plan)
├── config.json                 # Provider, routing, tools, memory, agent config
├── ai/
│   ├── ai.config.ts            # Config Parser with Env Overrides
│   ├── config-schema.ts        # Zod validation schema for full config
│   ├── llm.ts                  # Unified callLLM w/ streaming + response cache
│   ├── context-compressor.ts   # Minification, Slicing & JSON Compression
│   ├── response-cache.ts       # TF-IDF semantic cache (0.92 threshold)
│   └── providers/
│       ├── adapter.ts          # ProviderAdapter interface + ProviderRegistry
│       ├── llm-utils.ts        # Shared makeCompletionRequest() for all adapters
│       ├── groq-adapter.ts     # Groq provider adapter
│       ├── openrouter-adapter.ts  # OpenRouter provider adapter
│       ├── nvidia-adapter.ts   # Nvidia NIM provider adapter
│       ├── ollama-adapter.ts   # Ollama provider adapter
│       └── stream-adapter.ts   # SSE streaming adapter
├── sandbox/                    # Bun-Native Process Sandbox
├── fs/                         # Transactional Git File System
├── memory/
│   ├── store.ts                # Persistent Chats, Graph and Active Pruner
│   └── consolidator.ts         # Triplet Relationship Summarizer
├── modes/
│   ├── cli.ts                  # Interactive CLI Sub-modes (ask/agent/plan)
│   ├── ask/
│   │   ├── orchestrator.ts     # Ask mode orchestrator (fast/complex/action routing)
│   │   ├── tool-agent.ts       # Tool-calling agent for "action" route
│   │   ├── fast-path.ts        # Simple LLM call for "simple" route
│   │   └── panda-mode.ts       # Multi-step reasoning for "complex" route
│   ├── agent/
│   │   ├── orchestrator.ts     # Reactor Loop Orchestrator (undo/redo, formatting, session save)
│   │   ├── session-manager.ts  # Persistent multi-session CRUD under .pandaclaw/sessions/
│   │   ├── action-history.ts   # Undo/redo with content snapshots
│   │   ├── action-tracker.ts   # Action tracking with import() for session restore
│   │   ├── test-runner.ts      # Auto-detects test runners (bun, jest, vitest, etc.)
│   │   ├── types.ts            # Shared types (MutationPlan, ValidationResult, etc.)
│   │   └── swarm/              # Swarm Coordinator & Worker Dispatchers
│   ├── plan/                   # Strategic Planner Mode (goal → plan → per-step approval)
│   └── gateway/                # Unified Channel Gateway & Plugable Adapters
├── canvas/                     # Local Canvas Web Dashboard Server (port 18789)
├── vision/                     # 4-stage Vision Pipeline (Perceive → Locate → Reason → Act)
├── tools/                      # Safe/Risky Tool Registry (Tavily Search, Web Fetch, macOS Alarms, Dynamic Skills)
│   ├── code-formatter.ts       # Auto-detects formatters (Biome, dprint, Prettier, ESLint)
│   ├── diff-preview.ts         # Change preview utilities
│   ├── file-mentions.ts        # File reference tracking
│   ├── dynamic-loader.ts       # Recursive directory skill loader
│   └── canvas-tools.ts         # Visual canvas control interface
├── types/
│   └── shared.ts               # Shared type definitions (LearnedConstraint, RiskLevel)
├── utils/
│   └── logger.ts               # Structured logger with emoji/level/context
├── skills/                     # Workspace folder for pluggable user skills
└── tests/                      # Suite of 93 Unit Tests (config, providers, sessions, swarm, etc.)
```

---

## 🛠️ Installation

You can install PandaClaw using one of the three options below:

### Option 1: Automated Script (Recommended)
This script checks for/installs Bun, clones the repository locally, registers the executable globally, and initializes your configuration:
```bash
curl -fsSL https://raw.githubusercontent.com/senapati484/pandaclaw/main/install.sh | bash
```

### Option 2: via npm / Bun
If you are installing PandaClaw from the public npm registry:
```bash
# Global install using Bun (native runtime)
bun install -g pandaclaw

# Or global install using npm
npm install -g pandaclaw
```

### Option 3: Manual Clone (Development)
For local development:
```bash
# Clone the repository
git clone https://github.com/senapati484/pandaclaw
cd pandaclaw

# Install Bun dependencies
bun install

# Link the binary globally to PATH
npm install -g .
```

---

## ⚙️ Configuration

Start the interactive setup wizard to configure your model providers, API keys, and gateways:
```bash
pandaclaw setup
```
The wizard will ask you whether to save the configuration **Globally** (`~/.pandaclaw/config.json`) or **Locally** (`./config.json` inside your current directory).

You can also create or edit `config.json` manually:
```json
{
  "providers": {
    "groq": {
      "api_key": "YOUR_GROQ_API_KEY",
      "api_base": "https://api.groq.com/openai/v1"
    },
    "openrouter": {
      "api_key": "YOUR_OPENROUTER_API_KEY",
      "api_base": "https://openrouter.ai/api/v1"
    },
    "nvidia_nim": {
      "api_key": "YOUR_NVIDIA_NIM_KEY",
      "api_base": "https://integrate.api.nvidia.com/v1"
    },
    "ollama": {
      "api_key": "ollama",
      "api_base": "http://127.0.0.1:11434/v1"
    }
  },
  "routing": {
    "fast_path": {
      "provider": "groq",
      "model": "llama-3.1-8b-instant",
      "temperature": 0.1,
      "maxTokens": 2048
    },
    "panda_mode": {
      "provider": "openrouter",
      "model": "qwen/qwen3-coder:free",
      "temperature": 0.1,
      "maxTokens": 8192
    },
    "planning": {
      "provider": "openrouter",
      "model": "qwen/qwen3-next-80b-a3b-instruct:free",
      "temperature": 0.2,
      "maxTokens": 4096
    },
    "fallback_chain": [
      "groq",
      "openrouter",
      "nvidia_nim",
      "ollama"
    ]
  }
}
```

*Note: Environment variables (e.g. `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_NIM_KEY`) override `config.json` settings. No Telegram setup required — message [@pandaclawbot](https://t.me/pandaclawbot) to pair your device.*

---

## 🎮 Usage

PandaClaw offers several modes via direct CLI commands:

```bash
pandaclaw ask         # Quick answers, file ops, and shell commands
pandaclaw agent       # Autonomous swarm for complex multi-step goals
pandaclaw plan        # Goal → plan → execute with per-step approval
pandaclaw dashboard   # Start the Visual Canvas Web Dashboard (port 18789)
pandaclaw setup       # Configure API keys and providers interactively
pandaclaw sessions    # List, switch, or manage agent sessions
pandaclaw wakeup      # Launch the interactive welcome menu
```

Or use npm scripts:
```bash
bun run start         # Launch CLI (alias for `pandaclaw`)
bun run dashboard     # Start web dashboard
bun run setup         # Configure providers interactive
```

---

## 🔄 How the Reactor Loop Works

```
┌─────────────┐
│   OBSERVE   │  Index codebase, load memory & Knowledge Graph
└──────┬──────┘
       │
┌──────▼──────┐
│   REASON    │  Evaluate goal status and R1 thought budget
└──────┬──────┘
       │
┌──────▼──────┐
│    PLAN     │  Topological task graph generation & critical path
└──────┬──────┘
       │
┌──────▼──────┐
│   EXECUTE   │  Run workers (low risk → auto, high risk/git tx → approve)
└──────┬──────┘
       │
┌──────▼──────┐
│  VALIDATE   │  Verify output correctness & syntax critique
└──────┬──────┘
       │
┌──────▼──────┐
│   REFLECT   │  Record success/failure, update episodic graph
└─────────────┘
```

---

## ⚠️ Risk Safety Model

PandaClaw operates with safe defaults:

| Risk Level | Mutation Type | Behaviour |
| :--- | :--- | :--- |
| **Low** | Directory creation, file edits < 50KB | Auto-execute & validate |
| **Medium** | Large file edits, multiple mutations | Auto-execute up to threshold |
| **High** | Deletion, shell execution, config changes | Git transaction sandbox & interactive approval |

---

## 🐼 Bamboo
PandaClaw was built for **Bamboo** — a space-faring panda who loves leaves, logs, and logical reasoning. 🍃🐼

---

## 📜 License
PandaClaw is open-source software licensed under the [MIT License](LICENSE).
