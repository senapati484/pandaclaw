**PandaClaw – a local, deliberative AI assistant**  
*(summary of the whole repository, its purpose, how it works, and the key points that a non‑technical reader should walk away with)*  

---  

## 1️⃣ What PandaClaw is  

PandaClaw is a **personal AI helper that runs entirely on your own computer**.  
It is built with **TypeScript** and is meant to be executed with the **Bun** (or Node) runtime.  

The assistant follows a **“plan‑first, act‑second”** workflow:

1. **You give a high‑level goal** (e.g., “add a login page”, “summarise this repo”).  
2. The **planner** breaks the goal down into a **step‑by‑step plan** (a small dependency graph that shows which tasks must happen before others).  
3. A **swarm of specialised workers** (researcher, coder, verifier, visualizer, …) carry out the individual steps **in parallel** where possible.  
4. Every file change is performed **inside a sandbox** and recorded on a **temporary Git branch**.  
5. After the work is finished the changes are **validated**; if they pass, the temporary branch is merged into your real code, otherwise it is simply discarded – **your original files are never corrupted**.  

All of this is displayed in a **live, glass‑morphic web dashboard** (default `http://localhost:18789`) that shows the chat, the plan, a visual canvas, and a live diff of file changes.

---  

## 2️⃣ Core building blocks  

| Area | What it does | Where to find it |
|------|--------------|------------------|
| **Coordinator & Swarm** | `modes/agent/` – builds the plan, creates `SwarmTask`s, dispatches workers, manages a worker‑pool that caps concurrency to the number of CPU cores. | `modes/agent/` |
| **Planner & Executor** | `modes/plan/` – creates the dependency graph, optimises the order, runs the tasks, validates results. | `modes/plan/` |
| **Workers** | Individual agents that know how to **research**, **code**, **verify**, **visualise**, etc. Each implements the `Worker` interface. | `modes/agent/workers/` |
| **Sandbox** | Runs arbitrary scripts in an isolated Bun process, disables network, limits CPU time, and runs under a low‑privilege user. | `sandbox/` |
| **Git‑backed transaction layer** | `fs/` – creates a temporary branch `pandaclaw‑tx‑<uuid>` for every session, commits each mutation, and either merges or deletes the branch after validation. | `fs/` |
| **Vision pipeline** | `vision/` – four stages `perceive → locate → reason → act` for image‑based tasks (e.g., OCR, object detection). | `vision/` |
| **Episodic memory** | `memory/store.ts` writes a JSONL log of every action; `memory/consolidator.ts` turns the log into a lightweight knowledge graph that is fed back into future planning. | `memory/` |
| **Gateway adapters** | Connectors for **Telegram**, **Slack**, and a **web‑chat** UI, all exposing a common `Gateway` interface. | `gateways/` |
| **AI providers** | Thin wrappers for **Groq**, **OpenRouter**, **NVIDIA NIM**, and a **DeepSeek R1 compiler** that parses structured `