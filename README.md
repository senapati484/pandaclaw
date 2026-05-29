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

Unlike traditional agents that act instantly, PandaClaw operates with strict planning, multi-agent worker coordination, Git transaction boundaries, and a live visual canvas dashboard you run locally. If you want a Single-User Assistant that feels local, safe, highly thoughtful, and visually interactive—PandaClaw is it.

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

### 🎨 3. Local Visual Web Canvas
*   Serve a premium glassmorphic dashboard locally on `http://localhost:18789`.
*   **Chat Interface**: Real-time messaging with visual thinking traces.
*   **Visual Canvas**: Real-time canvas overlay rendering bounding box coordinates from the vision locating pipeline.
*   **Terminal & Diff Viewer**: Live system websocket logs with interactive Accept/Decline approval keys for file mutations.

### 🧠 4. Self-Consolidating Episodic Memory Graph
*   An idle compiler parses raw logs and uses Groq to structure entity constraints, success patterns, and lessons directly to `.pandaclaw/KNOWLEDGE_GRAPH.md`.
*   The Knowledge Graph is automatically loaded as contextual facts for subsequent tasks.

### ⚡ 5. Unified Pluggable Event Gateway
*   Abstracted channel adapter layer supporting pluggable integrations:
    *   `telegram`: Polling Telegram API routing text prompts and downloaded photo buffers.
    *   `slack`: POST webhook event ingestion and channel posts.
    *   `webchat`: Direct message routing from the local canvas dashboard.

---

## 📦 Project Directory Layout

```
pandaclaw/
├── index.ts                    # CLI Entrypoint (Commander)
├── config.json                 # Gateway & API Keys Config
├── ai/
│   ├── ai.config.ts            # Config Parser with Env Overrides
│   └── providers/
│       ├── nvidia-nim.ts       # NIM Vision Models
│       └── r1-compiler.ts      # DeepSeek R1 Parsing & Verifier
├── sandbox/                     # Bun-Native Process Sandbox
├── fs/                         # Transactional Git File System
├── memory/
│   ├── store.ts                # JSONL Persistent Memory
│   └── consolidator.ts         # Knowledge Graph Summarizer
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
├── tools/                      # Safe/Risky Tool Registry (Tavily Search, Web Fetch, Sandbox Exec)
└── tests/                      # Suite of 27 Unit Tests (Swarm, Sandbox, Transactions)
```

---

## 🛠️ Installation

```bash
# Clone the repository
git clone https://github.com/senapati484/pandaclaw
cd pandaclaw

# Install Bun dependencies
bun install

# Link the binary globally
bun link
```

---

## ⚙️ Configuration

Create or modify `config.json` at the root of the workspace:

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
  },
  "telegram": {
    "token": "YOUR_BOTFATHER_TOKEN",
    "allowed_users": [12345678]
  }
}
```

*You can also set these keys via environment variables (e.g. `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_NIM_KEY`, `TELEGRAM_TOKEN`).*

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
