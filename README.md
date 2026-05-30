# 🐼 PandaClaw

<p align="center">
  <img width="1594" height="329" alt="pandaclaw" src="https://github.com/user-attachments/assets/c7945125-8f33-435a-9913-aafaf1113351" />
</p>

<p align="center">
  <strong>Slow is smooth. Smooth is perfect.</strong>
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-%E2%89%A5%201.3.3-black?style=for-the-badge&logo=bun" alt="Bun version"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-v5-blue?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://groq.com/"><img src="https://img.shields.io/badge/Groq-Llama%203-orange?style=for-the-badge" alt="Groq Llama 3"></a>
  <a href="https://openrouter.ai/"><img src="https://img.shields.io/badge/OpenRouter-R1-deepskyblue?style=for-the-badge" alt="OpenRouter DeepSeek R1"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License"></a>
</p>

---

**PandaClaw** is a *deliberate, reasoning-first, and vision-native personal AI assistant* built on Bun. 

Unlike traditional agents that act instantly, PandaClaw operates with strict planning, multi-agent worker coordination, Git transaction boundaries, a live visual canvas dashboard, and an integrated multi-channel gateway (Telegram, Slack, WebChat) with native voice parsing and macOS alarm utilities.

---

## 🚀 PandaClaw v3 Core Architecture

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
*   **R1 Reasoning Compiler**: Extracts and parses structured DeepSeek R1 `<think>` traces and applies critique-correction verification loops.

### 🧠 3. PandaGraph Semantic Memory Engine
*   **Persistent Chat History**: Every message (user and assistant) is saved to `.pandaclaw/chats.jsonl` indexed by `chatId`. Conversation history persists seamlessly across gateway restarts!
*   **Knowledge Graph (Triplet Store)**: Semantic facts (user preferences, configurations, constraints, success patterns) are extracted and saved as relationships (`subject`, `predicate`, `object`) inside `.pandaclaw/graph_memory.json`.
*   **Auto-Sync Markdown**: Graph states are automatically formatted into a gorgeous, human-friendly document under **`.pandaclaw/KNOWLEDGE_GRAPH.md`** whenever the graph is modified.
*   **TF-IDF Semantic Recall**: An in-process keyword matching and term weight scorer (`recallRelevantRelations`) retrieves facts locally in **< 1ms** with zero API cost, keeping prompt contexts ultra-lean and relevant.
*   **Async Background Consolidation**: Every **3 messages**, the gateway automatically spawns a non-blocking background consolidation task to extract new facts from raw logs and write them to the graph without delaying user chat responses.

### ⚡ 4. Token Minimization & JSON Compression
*   **`compressJson` Utility**: Any JSON structure returned from tools is recursively processed to strip all spacing, newlines, and pretty-print formatting.
*   - Slices and prunes long arrays to a maximum of 15 items.
  - Truncates excessively long text values (strings >250 characters, e.g. base64 images or raw HTML scrapes) to prevent token bloat.
  - Prunes deep nested elements beyond depth 5.
*   **Minified Storage**: All system-generated JSON files (e.g. `graph_memory.json` and `paired-users.json`) are stored in minified format on disk for fast read/write times.

### 🎙️ 5. Native Voice & Audio processing
*   **Groq Whisper Integration**: Converts speech buffers (OGG, OPUS, MP3, WAV, MPEG) into text in **< 1 second** using Groq's high-performance `whisper-large-v3` endpoint.
*   **Gateway Adapters Support**: When a voice message is received from a paired Telegram user, the bot automatically downloads, transcribes, previews, and processes it inside the agent pipeline.

### 🎨 6. Local Visual Web Canvas
*   Serve a premium glassmorphic dashboard locally on `http://localhost:18789`.
*   **Chat Interface**: Real-time messaging with visual thinking traces.
*   **Visual Canvas**: Real-time canvas overlay rendering bounding box coordinates from the vision locating pipeline.
*   **Terminal & Diff Viewer**: Live system websocket logs with interactive Accept/Decline approval keys for file mutations.

### ⚡ 7. Pluggable Gateway & 3-Way Routing
*   Abstracted channel adapter layer supporting pluggable integrations (`telegram`, `slack`, `webchat`).
*   **Allowed Users Pairing**: Paired Telegram user IDs are stored per-device in `.pandaclaw/paired-users.json` (gitignored), ensuring committed configuration files are never contaminated or leaked.
*   **3-Way Classifier**: Routes queries dynamically:
    - `simple`  → snappier direct answering without tools (`runFastPath`).
    - `complex` → deep reasoning path using DeepSeek R1 compiler (`runPandaMode`).
    - `action`  → agentic tool-use loops (`runToolAgent`) with full filesystem/shell access.

---

## 📦 Project Directory Layout

```
pandaclaw/
├── index.ts                    # CLI Entrypoint (Commander)
├── config.json                 # Gateway & API Keys Config (Shared)
├── ai/
│   ├── ai.config.ts            # Config Parser with Env Overrides
│   ├── context-compressor.ts   # Minification, Slicing & JSON Compression
│   └── providers/
│       ├── nvidia-nim.ts       # NIM Vision Models
│       └── r1-compiler.ts      # DeepSeek R1 Parsing & Verifier
├── sandbox/                     # Bun-Native Process Sandbox
├── fs/                         # Transactional Git File System
├── memory/
│   ├── store.ts                # Persistent Chats, Graph and Scorer
│   └── consolidator.ts         # Triplet Relationship Summarizer
├── modes/
│   ├── cli.ts                  # Interactive CLI Sub-modes
│   ├── agent/
│   │   ├── orchestrator.ts     # Reactor Loop Orchestrator
│   │   └── swarm/              # Swarm Coordinator & Worker Dispatchers
│   ├── plan/                   # Strategic Planner Mode
│   ├── ask/                    # Codebase-Aware Conversation Mode
│   └── gateway/                # Unified Channel Gateway & Pluggable Adapters
├── canvas/                     # Local Canvas Web Dashboard Server
├── vision/                     # 4-stage Vision Pipeline (Perceive → Locate → Reason → Act)
├── tools/                      # Safe/Risky Tool Registry (Tavily Search, Web Fetch, Sandbox Exec, macOS Alarms)
└── tests/                      # Suite of 31 Unit Tests (Swarm, Sandbox, Transactions, PandaGraph)
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
    }
  }
}
```

*Note: Environment variables (e.g. `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_NIM_KEY`) will override `config.json` settings. No Telegram Token configuration is required! PandaClaw has a shared default bot token built directly into the codebase. You can immediately message [@pandaclawbot](https://t.me/pandaclawbot) on Telegram and securely pair your device without any manual BotFather setup.*

---

## 🎮 Usage

### 1. Launch CLI Wakeup menu
```bash
pandaclaw wakeup
# or
bun run dev
```

### 2. Start Visual Canvas Dashboard
```bash
bun run dashboard
```
Open `http://localhost:18789` in your browser to view the interactive control center.

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
PandaClaw was built for **Bamboo**, a space panda AI assistant who likes leaves, logs, and logical reasoning. 🍃

---

## 📜 License
PandaClaw is open-source software licensed under the [MIT License](LICENSE).
