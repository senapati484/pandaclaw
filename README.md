# 🐼 PandaClaw

> *Slow is smooth. Smooth is perfect.*

PandaClaw is a **reasoning-first agentic CLI** built with TypeScript and Bun. It plans before it acts, asks before it mutates, and learns from every session. Point it at a goal and watch it break the work down, validate each step, and reflect on what it did.

---

## Features

- **Agent Mode** — Observe → Reason → Plan → Execute → Reflect reactor loop. Creates, modifies, and deletes files based on your goal using a real LLM (Groq / OpenRouter) or a built-in offline planner.
- **Plan Mode** — Decompose a high-level goal into a validated, optimised task graph before touching anything.
- **Ask Mode** — Ask questions about the current codebase and get codebase-aware answers.
- **Hybrid execution** — Low-risk mutations run automatically; high-risk ones always ask for your approval first.
- **Free-tier LLM stack** — Groq (llama-3) is the default; OpenRouter is the fallback. Both have generous free tiers.
- **Session memory** — Constraints, error patterns, and reflections persist across iterations within a session.

---

## Requirements

| Tool | Version |
|------|---------|
| [Bun](https://bun.sh) | ≥ 1.3.3 |
| Node.js | not required (Bun replaces it) |

---

## Installation

```bash
# Clone the repo
git clone https://github.com/senapati484/pandaclaw
cd pandaclaw

# Install dependencies
bun install

# Link the CLI globally
bun link
```

After linking, the `pandaclaw` command is available anywhere on your system.

---

## Configuration

Copy `.env.example` (or create `.env`) and fill in at least one API key:

```env
YOUR_GROQ_API_KEY=gsk_...
YOUR_OPENROUTER_API_KEY=sk-or-v1-...
```

- **Groq** is the primary provider (fast, free tier, llama-3.1).
- **OpenRouter** is the fallback. Set `OPENROUTER_DEFAULT_MODEL` to override the model.
- If neither key is present, PandaClaw falls back to the built-in offline planner (pattern-matching, no LLM).

---

## Usage

### Wake up the panda

```bash
pandaclaw wakeup
```

This launches the interactive TUI. You will be prompted to choose a mode:

```
┌  PandaClaw 🐼
│
◇  Choose CLI sub-mode
│  ● Agent Mode
│  ○ Plan Mode
│  ○ Ask Mode
│  ○ ⬅ back to main menu
```

### Agent Mode

Creates and modifies files autonomously to achieve your goal.

```
What is your goal? › create one file named testing.txt
```

PandaClaw will:
1. Index the codebase
2. Plan the mutations needed (via LLM or offline planner)
3. Show each step and ask for approval on risky operations
4. Execute, validate, and reflect

### Plan Mode

Decomposes a goal into a validated task graph without executing anything.

```
What is the goal? › add authentication to the API
```

Outputs a structured plan with dependency ordering, risk estimates, and a critical path.

### Ask Mode

Ask any question about the codebase.

```
Ask PandaClaw a question › how does the reactor loop work?
```

---

## Project Structure

```
pandaclaw/
├── index.ts                  # CLI entry point (commander)
├── tui/
│   └── wakeup.ts             # ASCII banner + mode launcher
├── modes/
│   ├── cli.ts                # Mode router
│   ├── agent/
│   │   ├── orchestrator.ts   # Reactor loop (Observe→Reason→Plan→Execute→Reflect)
│   │   ├── action-planner.ts # LLM + offline mutation planner
│   │   ├── mutation-executor.ts  # File/folder/shell operations
│   │   ├── reflection-engine.ts  # Validates mutations, suggests next steps
│   │   ├── action-tracker.ts     # Logs every action with status
│   │   ├── session-memory.ts     # Constraints, errors, reflections
│   │   ├── context-manager.ts    # Codebase indexer
│   │   ├── model-selector.ts     # Groq / OpenRouter model picker
│   │   └── types.ts
│   ├── plan/
│   │   ├── orchestrator.ts   # Plan Mode entry point
│   │   ├── plan-generator.ts # Goal → task graph
│   │   ├── plan-validator.ts # Cycle detection, dependency check
│   │   ├── plan-optimizer.ts # Topological sort, critical path
│   │   └── types.ts
│   └── ask/
│       └── orchestrator.ts   # Ask Mode entry point
└── ai/
    └── ai.config.ts          # Vercel AI SDK configuration
```

---

## Development

```bash
# Run tests
bun test

# Run directly (without global link)
bun run index.ts wakeup

# Type-check
bun tsc --noEmit
```

---

## How the Reactor Loop Works

```
┌─────────────┐
│   OBSERVE   │  Index codebase, read session memory
└──────┬──────┘
       │
┌──────▼──────┐
│   REASON    │  Is the goal still incomplete? Should we continue?
└──────┬──────┘
       │
┌──────▼──────┐
│    PLAN     │  LLM or offline planner → MutationPlan (ordered steps)
└──────┬──────┘
       │
┌──────▼──────┐
│   EXECUTE   │  For each step: auto-exec (low risk) or ask (high risk)
└──────┬──────┘
       │
┌──────▼──────┐
│  VALIDATE   │  Check file exists / content matches intent
└──────┬──────┘
       │
┌──────▼──────┐
│   REFLECT   │  Learn from failures, update session memory
└─────────────┘
```

The loop exits when the goal is complete, all mutations are rejected, or `maxIterations` (default: 20) is reached.

---

## Risk Model

| Risk Level | Trigger | Behaviour |
|------------|---------|-----------|
| `low` | New file, small content | Auto-execute |
| `medium` | Large file, modify existing | Auto-execute (up to threshold) |
| `high` | Delete, shell command, `.env`, `package.json` | Always ask for approval |

---

## License

MIT
