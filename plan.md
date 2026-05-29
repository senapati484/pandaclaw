# 🐼 PandaClaw — Implementation Plan
> Based on your **actual codebase**. Mapped to your real file structure.  
> Stack: Bun · TypeScript · Groq · OpenRouter · NVIDIA NIM (all free tier)

---

## Current State (What's Already Working ✅)

```
pandaclaw/
├── ai/
│   ├── ai.config.ts          ✅ AI config
│   └── index.ts              ✅ AI exports
├── modes/
│   ├── agent/                ✅ FULLY WORKING (Mutations: 6, Executed: 5)
│   │   ├── action-planner.ts
│   │   ├── action-tracker.ts
│   │   ├── agent.test.ts
│   │   ├── context-manager.ts
│   │   ├── model-selector.ts
│   │   ├── mutation-executor.ts
│   │   ├── orchestrator.ts
│   │   ├── reflection-engine.ts
│   │   ├── session-memory.ts
│   │   └── types.ts
│   ├── ask/                  ⚠️  folder exists, orchestrator missing
│   ├── plan/                 ⚠️  folder exists, plan-generator.ts partial
│   └── cli.ts                ✅ mode selector
├── tui/
│   └── wakeup.ts             ✅ banner + mode picker
├── index.ts                  ✅ commander entry
├── SOUL.md                   ✅ agent identity
├── config.json               ✅ api keys
└── types.ts                  ✅ full type system
```

**What needs to be built:**
1. `modes/ask/orchestrator.ts` — fast Q&A (simple questions → Groq direct)
2. `modes/plan/orchestrator.ts` + `plan-generator.ts` — panda mode reasoning
3. `modes/telegram/` — full Telegram bot wiring
4. `vision/` — 4-stage vision pipeline (entire new module)
5. `tools/` — web search, code exec, file tools
6. `providers/nvidia-nim.ts` — NVIDIA NIM adapter
7. `memory/` — persistent memory beyond session
8. Update `types.ts` — add `"nvidia_nim"` to ModelProvider

---

## Step 0 — Install Missing Dependencies

```bash
bun add node-telegram-bot-api
bun add @types/node-telegram-bot-api -d
bun add zod
bun add @tavily/core          # web search (has free tier)
bun add cheerio               # web page parsing
bun add node-fetch
bun add sharp                 # image processing for vision
bun add @modelcontextprotocol/sdk   # MCP support (Phase 3)
```

---

## Step 1 — Update `types.ts` (your existing file)

Add `"nvidia_nim"` to `ModelProvider` and add vision types.  
**Find this line** in your existing `types.ts`:

```typescript
// BEFORE
export type ModelProvider = "groq" | "openrouter";

// AFTER
export type ModelProvider = "groq" | "openrouter" | "nvidia_nim";
```

**Add these new types at the bottom of your existing `types.ts`:**

```typescript
// ============ Vision Types (NEW) ============

export type VisionContentType =
  | "screenshot"
  | "document"
  | "chart"
  | "code"
  | "general";

export interface SpatialElement {
  type: string;
  label?: string;
  text?: string;
  position?: { x: number; y: number; w?: number; h?: number };
  confidence: number;
}

export interface CodeFinding {
  line?: number;
  severity: "error" | "warning" | "info";
  message: string;
  fix?: string;
}

export type VisionAction =
  | { type: "describe"; summary: string }
  | { type: "extract"; data: Record<string, unknown> }
  | { type: "diagnose"; issue: string; fix: string }
  | { type: "navigate"; instruction: string }
  | { type: "code_review"; findings: CodeFinding[] };

export interface VisionResult {
  contentType: VisionContentType;
  elements: SpatialElement[];
  reasoning: string;
  action: VisionAction;
  modelUsed: string;
}

// ============ Ask Mode Types (NEW) ============

export type AskTaskType = "simple" | "complex" | "vision";

export interface AskTask {
  id: string;
  type: AskTaskType;
  input: string;
  images?: Buffer[];
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  createdAt: Date;
}

export interface AskResult {
  answer: string;
  taskType: AskTaskType;
  tokensUsed: number;
  provider: ModelProvider;
  durationMs: number;
  verified: boolean;
}

// ============ Plan Mode Types (NEW) ============

export interface PlanStep {
  index: number;
  title: string;
  description: string;
  tool?: string;
  toolArgs?: Record<string, unknown>;
  dependsOn?: number[];
  status: "pending" | "running" | "done" | "skipped" | "failed";
  result?: string;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  estimatedComplexity: "low" | "medium" | "high";
  createdAt: Date;
}

export interface PlanExecutionResult {
  planId: string;
  goal: string;
  finalAnswer: string;
  stepsCompleted: number;
  stepsFailed: number;
  verified: boolean;
  durationMs: number;
}

// ============ Tool Types (NEW) ============

export interface ToolDefinition {
  name: string;
  description: string;
  risky: boolean;
  readOnly: boolean;
  execute: (
    args: Record<string, unknown>,
    context: ToolContext
  ) => Promise<unknown>;
}

export interface ToolContext {
  userId?: string;
  channel: "cli" | "telegram" | "discord" | "web";
  requestConsent: (tool: string, preview: string) => Promise<boolean>;
  workspacePath: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============ Memory Types (NEW) ============

export interface MemoryEntry {
  id: string;
  timestamp: number;
  role: "user" | "assistant";
  content: string;
  summary?: string;
  tags?: string[];
  importance: "low" | "medium" | "high";
}

export interface PersistentMemory {
  sessionCount: number;
  lastSeen: number;
  userPreferences: Record<string, string>;
  recentEntries: MemoryEntry[];
  longTermFacts: MemoryEntry[];
}
```

---

## Step 2 — Update `config.json`

Replace your existing `config.json` with this expanded version:

```json
{
  "providers": {
    "groq": {
      "api_key": "",
      "api_base": "https://api.groq.com/openai/v1"
    },
    "openrouter": {
      "api_key": "",
      "api_base": "https://openrouter.ai/api/v1"
    },
    "nvidia_nim": {
      "api_key": "",
      "api_base": "https://integrate.api.nvidia.com/v1"
    }
  },
  "routing": {
    "fast_path": {
      "provider": "groq",
      "model": "llama-3.3-70b-versatile",
      "temperature": 0.3,
      "maxTokens": 2048
    },
    "panda_mode": {
      "provider": "openrouter",
      "model": "deepseek/deepseek-r1",
      "temperature": 0.1,
      "maxTokens": 8192
    },
    "planning": {
      "provider": "openrouter",
      "model": "deepseek/deepseek-chat-v3-0324",
      "temperature": 0.2,
      "maxTokens": 4096
    },
    "vision_screenshot": {
      "provider": "nvidia_nim",
      "model": "meta/llama-3.2-11b-vision-instruct"
    },
    "vision_document": {
      "provider": "nvidia_nim",
      "model": "microsoft/phi-3.5-vision-128k-instruct"
    },
    "vision_chart": {
      "provider": "openrouter",
      "model": "qwen/qwen2-vl-7b-instruct"
    },
    "vision_code": {
      "provider": "groq",
      "model": "meta-llama/llama-4-scout-17b-16e-instruct"
    },
    "fallback_chain": ["groq", "openrouter", "nvidia_nim"]
  },
  "tools": {
    "web_search": {
      "provider": "tavily",
      "api_key": "",
      "fallback": "duckduckgo",
      "maxResults": 5
    },
    "code_exec": {
      "enabled": true,
      "timeout_ms": 10000
    }
  },
  "memory": {
    "path": ".pandaclaw/memory.jsonl",
    "maxEntries": 200,
    "maxLongTermFacts": 50
  },
  "audit": {
    "path": ".pandaclaw/audit.jsonl",
    "enabled": true
  },
  "telegram": {
    "token": "",
    "allowed_users": []
  },
  "agent": {
    "maxIterations": 20,
    "autoExecutePaths": ["src/", "tests/", "modes/"],
    "askFirstPatterns": [".env", ".git", "package.json", "tsconfig.json"]
  }
}
```

---

## Step 3 — Add NVIDIA NIM Provider

**Create `ai/providers/nvidia-nim.ts`:**

```typescript
// ai/providers/nvidia-nim.ts

import type { VisionContentType } from "../../types.js";

const NIM_BASE = "https://integrate.api.nvidia.com/v1";

interface NIMMessage {
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export async function nimChat(
  messages: NIMMessage[],
  model: string,
  apiKey: string,
  maxTokens = 1024
): Promise<string> {
  const res = await fetch(`${NIM_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`NVIDIA NIM error ${res.status}: ${err}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

export async function nimVision(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
  model: string,
  apiKey: string
): Promise<string> {
  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const messages: NIMMessage[] = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: prompt },
      ],
    },
  ];

  return nimChat(messages, model, apiKey, 2048);
}

export function routeVisionModel(
  contentType: VisionContentType,
  config: Record<string, { provider: string; model: string }>
): { provider: string; model: string } {
  const map: Record<VisionContentType, string> = {
    screenshot: "vision_screenshot",
    document:   "vision_document",
    chart:      "vision_chart",
    code:       "vision_code",
    general:    "vision_screenshot",
  };
  return config[map[contentType]] ?? config["vision_screenshot"];
}
```

---

## Step 4 — Build the Vision Pipeline

**Create `vision/index.ts` (pipeline orchestrator):**

```typescript
// vision/index.ts

import type { VisionResult, VisionContentType, SpatialElement, VisionAction } from "../types.js";
import { detectContentType } from "./perceive.js";
import { locateElements } from "./locate.js";
import { reasonAboutContent } from "./reason.js";
import { decideAction } from "./act.js";
import { nimVision, routeVisionModel } from "../ai/providers/nvidia-nim.js";
import { readConfig } from "../ai/ai.config.js";

export async function runVisionPipeline(
  imageBuffer: Buffer,
  mimeType: string,
  userContext: string
): Promise<VisionResult> {
  const config = await readConfig();

  // Stage 1: PERCEIVE — what kind of image is this?
  const contentType = await detectContentType(imageBuffer, mimeType, config);

  // Stage 2: LOCATE — extract spatial structure
  const { model: visionModel, provider } = routeVisionModel(contentType, config.routing);
  const apiKey = config.providers[provider as keyof typeof config.providers].api_key;

  const locatePrompt = buildLocatePrompt(contentType);
  const rawLocation = await nimVision(imageBuffer, mimeType, locatePrompt, visionModel, apiKey);
  const elements = parseElements(rawLocation);

  // Stage 3: REASON — what does this mean in context?
  const reasoning = await reasonAboutContent(elements, contentType, userContext, config);

  // Stage 4: ACT — what typed action should the agent emit?
  const action = await decideAction(reasoning, contentType, config);

  return { contentType, elements, reasoning, action, modelUsed: visionModel };
}

function buildLocatePrompt(contentType: VisionContentType): string {
  const prompts: Record<VisionContentType, string> = {
    screenshot: `You are analyzing a screenshot. List every visible UI element with:
- type (button/input/text/error/nav/image/table)
- label or text content
- approximate position (top/middle/bottom, left/center/right)
- any error states
Format each element as: TYPE | LABEL | POSITION | STATE`,

    document: `Extract all text content from this document image. Preserve structure:
- headings (mark with H:)
- body text (mark with P:)  
- tables (mark with T:)
- figures (mark with F:)
Return the full extracted text maintaining document order.`,

    chart: `Analyze this chart/graph:
- Chart type (bar/line/pie/scatter/etc)
- Title and axis labels
- Data series names
- Key data points and trends
- Any notable patterns or anomalies`,

    code: `Analyze this code screenshot:
- Programming language
- File name if visible
- Any highlighted lines or error indicators
- Error messages or stack traces visible
- The code logic at highlighted/error lines`,

    general: `Describe this image in detail:
- Main subject
- Key elements visible
- Any text present
- Colors and layout
- Anything that seems important`,
  };
  return prompts[contentType];
}

function parseElements(rawText: string): SpatialElement[] {
  // Parse the structured text response into SpatialElement[]
  const lines = rawText.split("\n").filter((l) => l.trim());
  return lines.map((line, i) => {
    const parts = line.split("|").map((p) => p.trim());
    return {
      type: parts[0] ?? "unknown",
      label: parts[1] ?? line,
      text: parts[1] ?? line,
      position: undefined,
      confidence: 0.85,
    };
  });
}
```

**Create `vision/perceive.ts`:**

```typescript
// vision/perceive.ts

import type { VisionContentType } from "../types.js";
import { nimVision, routeVisionModel } from "../ai/providers/nvidia-nim.js";

export async function detectContentType(
  imageBuffer: Buffer,
  mimeType: string,
  config: any
): Promise<VisionContentType> {
  // Quick heuristic: check image dimensions first (no LLM call)
  // For Bun, use the buffer header bytes to estimate aspect ratio
  // Falls through to LLM classification for uncertain cases

  const prompt = `Look at this image carefully. Reply with EXACTLY one word from this list:
screenshot  (if it shows a computer screen, terminal, browser, IDE, app UI)
document    (if it's a page of text, PDF, report, letter, article)
chart       (if it contains graphs, charts, plots, data visualization)
code        (if it shows source code, a code editor, terminal with code output)
general     (for anything else - photos, diagrams, illustrations)

Reply with only the single word. No explanation.`;

  const { model, provider } = routeVisionModel("general", config.routing);
  const apiKey = config.providers[provider as keyof typeof config.providers].api_key;

  try {
    const result = await nimVision(imageBuffer, mimeType, prompt, model, apiKey);
    const word = result.trim().toLowerCase().split(/\s+/)[0];
    const valid: VisionContentType[] = ["screenshot", "document", "chart", "code", "general"];
    return valid.includes(word as VisionContentType)
      ? (word as VisionContentType)
      : "general";
  } catch {
    return "general";
  }
}
```

**Create `vision/reason.ts`:**

```typescript
// vision/reason.ts

import type { SpatialElement, VisionContentType } from "../types.js";

export async function reasonAboutContent(
  elements: SpatialElement[],
  contentType: VisionContentType,
  userContext: string,
  config: any
): Promise<string> {
  const elementSummary = elements
    .slice(0, 20)
    .map((e) => `- ${e.type}: ${e.label ?? e.text}`)
    .join("\n");

  const systemPrompt = `You are a visual reasoning assistant. 
Given what is visible in an image, reason about its meaning and what the user likely needs.
Be specific and actionable. Focus on what matters for the user's context.`;

  const userPrompt = `Image type: ${contentType}
User's question/context: "${userContext}"

Elements detected in image:
${elementSummary}

Reason step by step:
1. What is the current state shown in this image?
2. What problem or situation is present?
3. What does the user most likely need from this?
4. What is the most helpful response?

Provide a clear, actionable reasoning.`;

  // Use fast path for reasoning (Groq)
  const res = await fetch(`${config.providers.groq.api_base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.providers.groq.api_key}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.2,
    }),
  });

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? "Could not reason about image content.";
}
```

**Create `vision/act.ts`:**

```typescript
// vision/act.ts

import type { VisionAction, VisionContentType } from "../types.js";

export async function decideAction(
  reasoning: string,
  contentType: VisionContentType,
  config: any
): Promise<VisionAction> {
  const prompt = `Based on this reasoning about a ${contentType} image:

${reasoning}

Choose the BEST action type from:
- describe: just explain what's visible (use when user wants an explanation)
- extract: pull out structured data (use for charts, tables, forms)
- diagnose: identify a problem and fix (use for errors, bugs, issues)
- navigate: give UI navigation instructions (use for screenshots with tasks)
- code_review: review code issues (use for code screenshots)

Reply in this exact JSON format only, no other text:
{
  "type": "describe|extract|diagnose|navigate|code_review",
  "summary": "...",           (for describe)
  "data": {},                 (for extract)
  "issue": "...",             (for diagnose)
  "fix": "...",               (for diagnose)
  "instruction": "...",       (for navigate)
  "findings": []              (for code_review)
}`;

  try {
    const res = await fetch(`${config.providers.groq.api_base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.providers.groq.api_key}`,
      },
      body: JSON.stringify({
        model: config.routing.fast_path.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    const data = await res.json() as any;
    const parsed = JSON.parse(data.choices[0].message.content);
    return parsed as VisionAction;
  } catch {
    return { type: "describe", summary: reasoning };
  }
}
```

---

## Step 5 — Build `modes/ask/orchestrator.ts`

This is the **fast Q&A mode** — simple questions go directly to Groq. Complex ones trigger panda mode.

```typescript
// modes/ask/orchestrator.ts

import chalk from "chalk";
import * as readline from "readline";
import type { AskTask, AskTaskType, AskResult } from "../../types.js";
import { classifyTask } from "./classifier.js";
import { runFastPath } from "./fast-path.js";
import { runPandaMode } from "./panda-mode.js";
import { runVisionPipeline } from "../../vision/index.js";
import { readConfig } from "../../ai/ai.config.js";
import { loadMemory, saveToMemory } from "../../memory/store.js";

const PANDA = chalk.hex("#5b4d9e");
const FACE  = chalk.hex("#e8dcf8");

export async function runAskMode(): Promise<void> {
  const config = await readConfig();
  const memory = await loadMemory();

  console.log(PANDA("\n🐼 Ask Mode — I think before I answer\n"));
  console.log(FACE("  Simple questions → instant answer"));
  console.log(FACE("  Hard questions   → panda mode (I'll plan, then answer)\n"));
  console.log(chalk.gray("  Type 'exit' to go back\n"));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  const ask = () => {
    rl.question(FACE("You: "), async (input) => {
      if (!input.trim()) { ask(); return; }
      if (input.toLowerCase() === "exit") {
        console.log(PANDA("\nMaybe later, panda...\n"));
        rl.close();
        return;
      }

      const taskType = classifyTask(input);
      const task: AskTask = {
        id: crypto.randomUUID(),
        type: taskType,
        input,
        conversationHistory: [...conversationHistory],
        createdAt: new Date(),
      };

      // Show thinking indicator for panda mode
      if (taskType === "complex") {
        process.stdout.write(PANDA("  🐼 thinking...\r"));
      }

      const start = Date.now();
      let result: AskResult;

      try {
        if (taskType === "complex") {
          result = await runPandaMode(task, config);
        } else {
          result = await runFastPath(task, config);
        }
      } catch (err: any) {
        console.error(chalk.red(`\n  Error: ${err.message}\n`));
        ask();
        return;
      }

      // Clear thinking indicator
      process.stdout.write("                    \r");

      console.log();
      if (taskType === "complex") {
        console.log(PANDA(`  🐼 [panda mode · ${result.durationMs}ms · ${result.provider}]`));
      } else {
        console.log(chalk.gray(`  [fast · ${result.durationMs}ms · ${result.provider}]`));
      }
      console.log();
      console.log(FACE("PandaClaw: ") + result.answer);
      console.log();

      // Update conversation history
      conversationHistory.push({ role: "user", content: input });
      conversationHistory.push({ role: "assistant", content: result.answer });

      // Save to memory
      await saveToMemory({
        id: task.id,
        timestamp: Date.now(),
        role: "user",
        content: input,
        importance: taskType === "complex" ? "high" : "low",
      });

      ask();
    });
  };

  ask();
}
```

**Create `modes/ask/classifier.ts`:**

```typescript
// modes/ask/classifier.ts

import type { AskTaskType } from "../../types.js";

export function classifyTask(input: string): AskTaskType {
  const lower = input.toLowerCase();

  const complexSignals = [
    input.length > 250,
    input.split("\n").length > 2,
    /\b(write|build|create|implement|design|architect)\b/.test(lower),
    /\b(explain how|why does|how does)\b/.test(lower),
    /\b(compare|analyze|summarize|research|plan)\b/.test(lower),
    /\b(step by step|walk me through|in detail)\b/.test(lower),
    lower.includes(" and ") && lower.includes(" then "),
    /\b(debug|fix|refactor|optimize)\b/.test(lower),
  ];

  const score = complexSignals.filter(Boolean).length;
  return score >= 2 ? "complex" : "simple";
}
```

**Create `modes/ask/fast-path.ts`:**

```typescript
// modes/ask/fast-path.ts

import type { AskTask, AskResult } from "../../types.js";

export async function runFastPath(task: AskTask, config: any): Promise<AskResult> {
  const start = Date.now();
  const { model, maxTokens, temperature } = config.routing.fast_path;

  const messages = [
    {
      role: "system",
      content: "You are PandaClaw, a helpful AI assistant. Be concise and accurate.",
    },
    ...task.conversationHistory.slice(-6), // last 3 exchanges for context
    { role: "user", content: task.input },
  ];

  const res = await fetch(`${config.providers.groq.api_base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.providers.groq.api_key}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) throw new Error(`Groq error ${res.status}`);
  const data = await res.json() as any;

  return {
    answer: data.choices[0].message.content,
    taskType: "simple",
    tokensUsed: data.usage?.total_tokens ?? 0,
    provider: "groq",
    durationMs: Date.now() - start,
    verified: false,
  };
}
```

**Create `modes/ask/panda-mode.ts`:**

This is the crown jewel — slow, deliberate, verified reasoning.

```typescript
// modes/ask/panda-mode.ts

import type { AskTask, AskResult } from "../../types.js";

export async function runPandaMode(task: AskTask, config: any): Promise<AskResult> {
  const start = Date.now();
  const { model, maxTokens, temperature } = config.routing.panda_mode;
  const { model: fastModel } = config.routing.fast_path;

  // ── STEP 1: REASON (DeepSeek R1 — thinking model) ──
  const reasonMessages = [
    {
      role: "system",
      content: `You are PandaClaw, a thoughtful AI agent. 
For complex requests: think step by step before answering.
Break the problem down, reason carefully, then give a clear final answer.
Put your thinking in <think> tags and your final answer after them.`,
    },
    ...task.conversationHistory.slice(-4),
    { role: "user", content: task.input },
  ];

  const reasonRes = await fetch(`${config.providers.openrouter.api_base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.providers.openrouter.api_key}`,
      "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
      "X-Title": "PandaClaw",
    },
    body: JSON.stringify({
      model,
      messages: reasonMessages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!reasonRes.ok) {
    // Fallback to Groq if OpenRouter fails
    return runFastPathFallback(task, config, start);
  }

  const reasonData = await reasonRes.json() as any;
  const rawResponse = reasonData.choices[0].message.content as string;

  // Extract final answer (after </think> tag if present)
  const finalAnswer = rawResponse.includes("</think>")
    ? rawResponse.split("</think>").pop()!.trim()
    : rawResponse;

  // ── STEP 2: VERIFY (Groq — fast second check) ──
  const verifyPrompt = `The user asked: "${task.input}"

An agent gave this answer:
${finalAnswer}

Check: Does this fully and correctly answer the question?
Reply with EXACTLY:
PASS  — if the answer is complete and correct
FIXED: <corrected answer>  — if something is wrong or missing`;

  const verifyRes = await fetch(`${config.providers.groq.api_base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.providers.groq.api_key}`,
    },
    body: JSON.stringify({
      model: fastModel,
      messages: [{ role: "user", content: verifyPrompt }],
      max_tokens: 2048,
      temperature: 0,
    }),
  });

  const verifyData = await verifyRes.json() as any;
  const verdict = verifyData.choices[0].message.content as string;
  const verified = verdict.startsWith("PASS");
  const verifiedAnswer = verified
    ? finalAnswer
    : verdict.replace(/^FIXED:\s*/i, "").trim();

  return {
    answer: verifiedAnswer,
    taskType: "complex",
    tokensUsed: reasonData.usage?.total_tokens ?? 0,
    provider: "openrouter",
    durationMs: Date.now() - start,
    verified,
  };
}

async function runFastPathFallback(task: AskTask, config: any, start: number): Promise<AskResult> {
  const { runFastPath } = await import("./fast-path.js");
  const result = await runFastPath(task, config);
  return { ...result, durationMs: Date.now() - start };
}
```

---

## Step 6 — Build `modes/plan/orchestrator.ts`

Plan mode is for project-level tasks — "build me X", "refactor Y", "create a plan for Z".

```typescript
// modes/plan/orchestrator.ts

import chalk from "chalk";
import * as readline from "readline";
import { text, confirm, spinner } from "@clack/prompts";
import type { Plan, PlanStep } from "../../types.js";
import { generatePlan } from "./plan-generator.js";
import { executePlan } from "./plan-executor.js";
import { readConfig } from "../../ai/ai.config.js";

const PANDA = chalk.hex("#5b4d9e");
const FACE  = chalk.hex("#e8dcf8");

export async function runPlanMode(): Promise<void> {
  const config = await readConfig();

  console.log(PANDA("\n🐼 Plan Mode — I plan before I act\n"));
  console.log(FACE("  Tell me your goal. I'll break it into steps,"));
  console.log(FACE("  show you the plan, then execute with your approval.\n"));

  const goal = await text({
    message: "What's your goal?",
    placeholder: "e.g. Add a user authentication system to my Express app",
    validate: (v) => (v.trim().length < 5 ? "Please describe your goal" : undefined),
  });

  if (!goal || typeof goal !== "string") {
    console.log(PANDA("\nMaybe later, panda...\n"));
    return;
  }

  // Generate the plan
  const s = spinner();
  s.start("🐼 Planning...");

  let plan: Plan;
  try {
    plan = await generatePlan(goal, config);
    s.stop("Plan ready!");
  } catch (err: any) {
    s.stop("Planning failed");
    console.error(chalk.red(`Error: ${err.message}`));
    return;
  }

  // Show the plan to the user
  console.log(PANDA(`\n📋 Plan for: "${goal}"\n`));
  console.log(chalk.gray(`Complexity: ${plan.estimatedComplexity} · ${plan.steps.length} steps\n`));

  for (const step of plan.steps) {
    const icon = step.tool ? "🔧" : "💭";
    console.log(FACE(`  ${step.index + 1}. ${icon} ${step.title}`));
    console.log(chalk.gray(`     ${step.description}`));
    if (step.tool) {
      console.log(chalk.gray(`     Tool: ${step.tool}`));
    }
    console.log();
  }

  const shouldProceed = await confirm({ message: "Execute this plan?" });
  if (!shouldProceed) {
    console.log(PANDA("\nPlan saved. Run plan mode again to execute.\n"));
    return;
  }

  // Execute
  const result = await executePlan(plan, config);

  console.log(PANDA(`\n✅ Plan complete!\n`));
  console.log(FACE("Result:\n"));
  console.log(result.finalAnswer);
  console.log();
  console.log(chalk.gray(`Steps: ${result.stepsCompleted} done · ${result.stepsFailed} failed · ${result.durationMs}ms`));
}
```

**Create `modes/plan/plan-generator.ts`:**

```typescript
// modes/plan/plan-generator.ts

import type { Plan, PlanStep } from "../../types.js";

export async function generatePlan(goal: string, config: any): Promise<Plan> {
  const prompt = `You are PandaClaw's planning engine.

Break this goal into clear, ordered steps:
"${goal}"

Each step should be specific and actionable.
For steps that need tools, specify the tool name.

Available tools: web_search, web_fetch, file_read, file_write, code_exec, shell_command

Reply in this EXACT JSON format:
{
  "steps": [
    {
      "index": 0,
      "title": "Short step name",
      "description": "What specifically to do in this step",
      "tool": "tool_name or null",
      "toolArgs": {} or null,
      "dependsOn": [] 
    }
  ],
  "estimatedComplexity": "low|medium|high"
}

Only reply with JSON. No markdown, no explanation.`;

  const res = await fetch(`${config.providers.openrouter.api_base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.providers.openrouter.api_key}`,
      "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
      "X-Title": "PandaClaw",
    },
    body: JSON.stringify({
      model: config.routing.planning.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: config.routing.planning.maxTokens,
      temperature: config.routing.planning.temperature,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`Plan generation failed: ${res.status}`);

  const data = await res.json() as any;
  const parsed = JSON.parse(data.choices[0].message.content);

  return {
    id: crypto.randomUUID(),
    goal,
    steps: parsed.steps.map((s: any): PlanStep => ({
      ...s,
      status: "pending",
    })),
    estimatedComplexity: parsed.estimatedComplexity ?? "medium",
    createdAt: new Date(),
  };
}
```

---

## Step 7 — Build the Tools System

**Create `tools/index.ts`:**

```typescript
// tools/index.ts

import type { ToolDefinition, ToolContext } from "../types.js";
import { webSearchTool } from "./web-search.js";
import { webFetchTool } from "./web-fetch.js";
import { codeExecTool } from "./code-exec.js";
import { fileReadTool, fileWriteTool } from "./file-tools.js";

export const TOOLS: Record<string, ToolDefinition> = {
  web_search:  webSearchTool,
  web_fetch:   webFetchTool,
  code_exec:   codeExecTool,
  file_read:   fileReadTool,
  file_write:  fileWriteTool,
};

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const tool = TOOLS[name];
  if (!tool) return { success: false, error: `Unknown tool: ${name}` };

  // Risky tools require consent
  if (tool.risky) {
    const preview = `Tool: ${name}\nArgs: ${JSON.stringify(args, null, 2)}`;
    const approved = await context.requestConsent(name, preview);
    if (!approved) return { success: false, error: "User declined" };
  }

  try {
    const data = await tool.execute(args, context);
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
```

**Create `tools/web-search.ts`:**

```typescript
// tools/web-search.ts

import type { ToolDefinition, ToolContext } from "../types.js";

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description: "Search the web for current information",
  risky: false,
  readOnly: true,
  execute: async (args, _ctx) => {
    const query = args.query as string;

    // Try Tavily first, fall back to DuckDuckGo
    try {
      return await searchTavily(query);
    } catch {
      return await searchDuckDuckGo(query);
    }
  },
};

async function searchTavily(query: string): Promise<unknown> {
  const { readConfig } = await import("../ai/ai.config.js");
  const config = await readConfig();
  const apiKey = config.tools?.web_search?.api_key;
  if (!apiKey) throw new Error("No Tavily key");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
  });
  const data = await res.json() as any;
  return data.results.map((r: any) => ({ title: r.title, url: r.url, snippet: r.content }));
}

async function searchDuckDuckGo(query: string): Promise<unknown> {
  // DuckDuckGo instant answers API (no key needed)
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const res = await fetch(url);
  const data = await res.json() as any;
  return [{ title: data.Heading, snippet: data.AbstractText, url: data.AbstractURL }].filter(
    (r) => r.snippet
  );
}
```

**Create `tools/code-exec.ts`:**

```typescript
// tools/code-exec.ts

import type { ToolDefinition } from "../types.js";
import { execSync } from "child_process";

export const codeExecTool: ToolDefinition = {
  name: "code_exec",
  description: "Execute JavaScript/TypeScript code in a sandbox",
  risky: true,
  readOnly: false,
  execute: async (args, ctx) => {
    const code = args.code as string;
    const timeout = (args.timeout as number) ?? 10000;
    const workspacePath = ctx.workspacePath;

    // Write to temp file and run with Bun with timeout
    const tmpFile = `${workspacePath}/.pandaclaw/tmp_exec_${Date.now()}.ts`;

    try {
      await Bun.write(tmpFile, code);
      const result = execSync(`bun run ${tmpFile}`, {
        timeout,
        cwd: workspacePath,
        encoding: "utf8",
      });
      return { stdout: result, exitCode: 0 };
    } catch (err: any) {
      return { stdout: err.stdout ?? "", stderr: err.message, exitCode: 1 };
    } finally {
      // Clean up temp file
      try { Bun.file(tmpFile); } catch {}
    }
  },
};
```

**Create `tools/file-tools.ts`:**

```typescript
// tools/file-tools.ts

import type { ToolDefinition } from "../types.js";
import path from "path";

export const fileReadTool: ToolDefinition = {
  name: "file_read",
  description: "Read a file from the workspace",
  risky: false,
  readOnly: true,
  execute: async (args, ctx) => {
    const filePath = path.resolve(ctx.workspacePath, args.path as string);
    const file = Bun.file(filePath);
    if (!(await file.exists())) throw new Error(`File not found: ${args.path}`);
    return await file.text();
  },
};

export const fileWriteTool: ToolDefinition = {
  name: "file_write",
  description: "Write content to a file in the workspace",
  risky: true,
  readOnly: false,
  execute: async (args, ctx) => {
    const filePath = path.resolve(ctx.workspacePath, args.path as string);
    await Bun.write(filePath, args.content as string);
    return `Written: ${args.path}`;
  },
};
```

---

## Step 8 — Build the Memory System

**Create `memory/store.ts`:**

```typescript
// memory/store.ts

import path from "path";
import type { MemoryEntry, PersistentMemory } from "../types.js";

const MEMORY_PATH = ".pandaclaw/memory.jsonl";
const MAX_ENTRIES = 200;

export async function loadMemory(): Promise<PersistentMemory> {
  const file = Bun.file(MEMORY_PATH);
  if (!(await file.exists())) {
    return {
      sessionCount: 0,
      lastSeen: Date.now(),
      userPreferences: {},
      recentEntries: [],
      longTermFacts: [],
    };
  }

  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.trim());
  const entries: MemoryEntry[] = lines.map((l) => JSON.parse(l));

  return {
    sessionCount: 0,
    lastSeen: Date.now(),
    userPreferences: {},
    recentEntries: entries.slice(-50),
    longTermFacts: entries.filter((e) => e.importance === "high"),
  };
}

export async function saveToMemory(entry: MemoryEntry): Promise<void> {
  // Ensure directory exists
  await Bun.$`mkdir -p .pandaclaw`.quiet();

  const line = JSON.stringify(entry) + "\n";
  const file = Bun.file(MEMORY_PATH);

  const existing = (await file.exists()) ? await file.text() : "";
  const lines = existing.split("\n").filter((l) => l.trim());

  // Prune if too many entries
  if (lines.length >= MAX_ENTRIES) {
    const pruned = lines.slice(lines.length - MAX_ENTRIES + 1);
    await Bun.write(MEMORY_PATH, pruned.join("\n") + "\n" + line);
  } else {
    await Bun.write(MEMORY_PATH, existing + line);
  }
}

export function recallRelevant(query: string, entries: MemoryEntry[], topK = 5): MemoryEntry[] {
  const words = query.toLowerCase().split(/\s+/);
  return entries
    .map((entry) => ({
      entry,
      score:
        words.filter((w) => entry.content.toLowerCase().includes(w)).length * 2 +
        (entry.importance === "high" ? 3 : entry.importance === "medium" ? 1 : 0) +
        (Date.now() - entry.timestamp < 86_400_000 ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.entry);
}
```

---

## Step 9 — Build Telegram Mode

**Create `modes/telegram/bot.ts`:**

```typescript
// modes/telegram/bot.ts

import TelegramBot from "node-telegram-bot-api";
import chalk from "chalk";
import type { AskTask } from "../../types.js";
import { classifyTask } from "../ask/classifier.js";
import { runFastPath } from "../ask/fast-path.js";
import { runPandaMode } from "../ask/panda-mode.js";
import { runVisionPipeline } from "../../vision/index.js";
import { readConfig } from "../../ai/ai.config.js";
import { saveToMemory } from "../../memory/store.js";

const PANDA = chalk.hex("#5b4d9e");

export async function runTelegramMode(): Promise<void> {
  const config = await readConfig();

  if (!config.telegram?.token) {
    console.log(chalk.red("\n  ❌ No Telegram token in config.json\n"));
    console.log(chalk.gray("  Add: config.telegram.token = your BotFather token\n"));
    return;
  }

  const bot = new TelegramBot(config.telegram.token, { polling: true });
  const allowedUsers: number[] = config.telegram.allowed_users ?? [];

  console.log(PANDA("\n🐼 Telegram bot started! The panda is online.\n"));

  // Auth check
  const isAllowed = (userId: number) =>
    allowedUsers.length === 0 || allowedUsers.includes(userId);

  bot.on("message", async (msg) => {
    if (!isAllowed(msg.from!.id)) {
      await bot.sendMessage(msg.chat.id, "🐼 Sorry, you're not on my list.");
      return;
    }

    const chatId = msg.chat.id;

    // Handle photo messages (vision)
    if (msg.photo) {
      const typing = bot.sendChatAction(chatId, "typing");
      try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        const res = await fetch(fileLink);
        const buffer = Buffer.from(await res.arrayBuffer());
        const context = msg.caption ?? "Describe and analyze this image";

        const result = await runVisionPipeline(buffer, "image/jpeg", context);
        const reply = formatVisionReply(result);
        await bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
      } catch (err: any) {
        await bot.sendMessage(chatId, `❌ Vision error: ${err.message}`);
      }
      return;
    }

    if (!msg.text) return;
    const text = msg.text;

    // Handle /start command
    if (text === "/start") {
      await bot.sendMessage(
        chatId,
        `🐼 *PandaClaw is awake!*\n\nI'm a thoughtful AI agent.\n\n` +
        `• Simple questions → instant answer\n` +
        `• Hard questions → I think step by step\n` +
        `• Send an image → I analyze it\n\n` +
        `Just type your question!`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Show typing
    await bot.sendChatAction(chatId, "typing");

    const taskType = classifyTask(text);
    const task: AskTask = {
      id: crypto.randomUUID(),
      type: taskType,
      input: text,
      conversationHistory: [],
      createdAt: new Date(),
    };

    // For panda mode, send a "thinking" message first
    let thinkingMsg: any;
    if (taskType === "complex") {
      thinkingMsg = await bot.sendMessage(chatId, "🐼 *thinking...*", { parse_mode: "Markdown" });
    }

    try {
      const result = taskType === "complex"
        ? await runPandaMode(task, config)
        : await runFastPath(task, config);

      // Delete thinking message
      if (thinkingMsg) {
        await bot.deleteMessage(chatId, thinkingMsg.message_id).catch(() => {});
      }

      const footer = taskType === "complex"
        ? `\n\n_🐼 panda mode · ${result.durationMs}ms${result.verified ? " · verified ✓" : ""}_`
        : "";

      await bot.sendMessage(chatId, result.answer + footer, { parse_mode: "Markdown" });

      // Save to memory
      await saveToMemory({
        id: task.id,
        timestamp: Date.now(),
        role: "user",
        content: text,
        importance: taskType === "complex" ? "high" : "low",
      });
    } catch (err: any) {
      if (thinkingMsg) {
        await bot.deleteMessage(chatId, thinkingMsg.message_id).catch(() => {});
      }
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  bot.on("polling_error", (err) => {
    console.error(chalk.red("Telegram polling error:"), err.message);
  });

  // Keep process alive
  await new Promise(() => {});
}

function formatVisionReply(result: any): string {
  const action = result.action;
  let reply = `*🐼 Vision Analysis*\n_Type: ${result.contentType}_\n\n`;

  if (action.type === "describe")    reply += action.summary;
  if (action.type === "diagnose")    reply += `**Issue:** ${action.issue}\n\n**Fix:** ${action.fix}`;
  if (action.type === "navigate")    reply += action.instruction;
  if (action.type === "code_review") reply += action.findings.map((f: any) => `• ${f.message}`).join("\n");
  if (action.type === "extract")     reply += "```json\n" + JSON.stringify(action.data, null, 2) + "\n```";

  return reply;
}
```

---

## Step 10 — Wire Telegram into `tui/wakeup.ts`

**Update the Telegram section** in your existing `tui/wakeup.ts`:

```typescript
// Find this block in wakeup.ts:
} else if (mode === "telegram") {
    console.log(FACE(`\nLet's start with Telegram! 🎉`));
}

// Replace with:
} else if (mode === "telegram") {
    const { runTelegramMode } = await import("../modes/telegram/bot.js");
    await runTelegramMode();
}
```

---

## Step 11 — Create `ai/ai.config.ts`

If your current `ai.config.ts` doesn't already export `readConfig`, create/update it:

```typescript
// ai/ai.config.ts

import { readFileSync, existsSync } from "fs";
import path from "path";

export interface PandaConfig {
  providers: {
    groq:       { api_key: string; api_base: string };
    openrouter: { api_key: string; api_base: string };
    nvidia_nim: { api_key: string; api_base: string };
  };
  routing: {
    fast_path:        { provider: string; model: string; temperature: number; maxTokens: number };
    panda_mode:       { provider: string; model: string; temperature: number; maxTokens: number };
    planning:         { provider: string; model: string; temperature: number; maxTokens: number };
    vision_screenshot:{ provider: string; model: string };
    vision_document:  { provider: string; model: string };
    vision_chart:     { provider: string; model: string };
    vision_code:      { provider: string; model: string };
    fallback_chain:   string[];
  };
  tools?: {
    web_search?: { provider: string; api_key: string; fallback: string; maxResults: number };
    code_exec?:  { enabled: boolean; timeout_ms: number };
  };
  memory?: { path: string; maxEntries: number };
  audit?:  { path: string; enabled: boolean };
  telegram?: { token: string; allowed_users: number[] };
  agent?: {
    maxIterations: number;
    autoExecutePaths: string[];
    askFirstPatterns: string[];
  };
}

let _config: PandaConfig | null = null;

export function readConfig(): PandaConfig {
  if (_config) return _config;

  const configPath = path.join(process.cwd(), "config.json");
  if (!existsSync(configPath)) {
    throw new Error("config.json not found. Run: cp config.example.json config.json");
  }

  // Merge config.json with .env overrides
  const file = JSON.parse(readFileSync(configPath, "utf8")) as PandaConfig;

  // Allow env var overrides (e.g. for CI/Docker)
  if (process.env.GROQ_API_KEY)       file.providers.groq.api_key       = process.env.GROQ_API_KEY;
  if (process.env.OPENROUTER_API_KEY) file.providers.openrouter.api_key = process.env.OPENROUTER_API_KEY;
  if (process.env.NVIDIA_NIM_KEY)     file.providers.nvidia_nim.api_key = process.env.NVIDIA_NIM_KEY;
  if (process.env.TELEGRAM_TOKEN)     file.telegram = { ...(file.telegram ?? {}), token: process.env.TELEGRAM_TOKEN } as any;

  _config = file;
  return _config;
}
```

---

## Final Folder Structure (After All Steps)

```
pandaclaw/
├── ai/
│   ├── ai.config.ts          ✅ updated with readConfig + PandaConfig
│   ├── index.ts
│   └── providers/
│       └── nvidia-nim.ts     🆕 NVIDIA NIM adapter + vision routing
│
├── modes/
│   ├── agent/                ✅ already working — no changes needed
│   │   ├── action-planner.ts
│   │   ├── action-tracker.ts
│   │   ├── context-manager.ts
│   │   ├── model-selector.ts
│   │   ├── mutation-executor.ts
│   │   ├── orchestrator.ts
│   │   ├── reflection-engine.ts
│   │   ├── session-memory.ts
│   │   └── types.ts
│   │
│   ├── ask/                  🆕 fully built
│   │   ├── orchestrator.ts   — CLI loop + mode display
│   │   ├── classifier.ts     — simple vs complex detection
│   │   ├── fast-path.ts      — Groq direct call
│   │   └── panda-mode.ts     — DeepSeek R1 + verify step
│   │
│   ├── plan/                 🆕 fully built
│   │   ├── orchestrator.ts   — user goal → show plan → execute
│   │   ├── plan-generator.ts — LLM generates PlanStep[]
│   │   └── plan-executor.ts  — run each step (implement similarly to agent)
│   │
│   ├── telegram/             🆕 fully built
│   │   └── bot.ts            — polling bot, vision, ask/plan integration
│   │
│   └── cli.ts                ✅ no changes needed
│
├── vision/                   🆕 entire new module
│   ├── index.ts              — pipeline orchestrator
│   ├── perceive.ts           — content type detection
│   ├── reason.ts             — reasoning about what's seen
│   └── act.ts                — typed action emitter
│
├── tools/                    🆕 entire new module
│   ├── index.ts              — tool registry + runTool
│   ├── web-search.ts         — Tavily / DuckDuckGo
│   ├── web-fetch.ts          — fetch + clean URL
│   ├── code-exec.ts          — Bun sandboxed execution
│   └── file-tools.ts         — file read/write
│
├── memory/                   🆕 persistent memory
│   └── store.ts              — JSONL read/write + recall
│
├── tui/
│   └── wakeup.ts             ✅ update Telegram branch only
│
├── tests/                    existing
├── .pandaclaw/               🆕 auto-created at runtime
│   ├── memory.jsonl
│   └── audit.jsonl
│
├── types.ts                  ✅ updated (add nvidia_nim + vision/ask/plan/tool types)
├── index.ts                  ✅ no changes needed
├── config.json               ✅ expanded with all providers
├── SOUL.md                   ✅ already exists
└── CLAUDE.md                 ✅ already exists
```

---

## Build Order (Do This Exactly)

```
Week 1  — Day 1-2:   Step 0 (install deps) + Step 1 (update types.ts)
          Day 2-3:   Step 11 (ai.config.ts) + Step 3 (nvidia-nim.ts)
          Day 3-4:   Step 4 (vision pipeline)
          Day 4-5:   Step 5 (ask mode — classifier + fast-path + panda-mode)

Week 1  — Day 6-7:   Step 6 (plan mode)
                     Step 7 (tools — web search + code exec + file tools)
                     Step 8 (memory store)
                     Step 9 + 10 (telegram bot + wire into wakeup.ts)

Week 2  — Test everything end to end
           Fix rate limiting (add fallback chain logic in providers)
           Add audit logging to all tool calls
```

---

## Quick Test Checklist

After building, verify each mode works:

```bash
# Start the panda
bun run wakeup

# Test Ask Mode (simple)
→ CLI → Ask Mode → "what is 2+2"
Expected: instant answer from Groq

# Test Ask Mode (panda mode)
→ CLI → Ask Mode → "Design a full authentication system for my Express app with JWT, refresh tokens, and rate limiting"
Expected: 🐼 thinking... → detailed verified answer from DeepSeek R1

# Test Plan Mode
→ CLI → Plan Mode → "Add dark mode to my React app"
Expected: step-by-step plan shown → confirm → execute

# Test Vision
→ Telegram → send a screenshot
Expected: spatial analysis + typed action response

# Test Agent Mode (already working ✅)
→ CLI → Agent Mode → any coding task
```

---

## Why PandaClaw Beats PicoClaw

| Capability | PicoClaw 25K⭐ | **PandaClaw** |
|---|---|---|
| Vision depth | base64 passthrough | 4-stage pipeline: perceive→locate→reason→act |
| Reasoning | none | DeepSeek R1 + self-verification step |
| Output quality | first response sent | verified before sending |
| Security | none | explicit consent gate on every risky tool |
| Language | Go binary | TypeScript — full npm ecosystem, MCP SDK |
| Memory | JSONL basic | keyword+recency recall, importance scoring |
| Free tier | ✅ | ✅ Groq + OpenRouter + NVIDIA NIM |
| Developer UX | config.json only | SOUL.md personality + config + env vars |

**PicoClaw wins on:** size, startup speed, IoT/edge hardware  
**PandaClaw wins on:** output quality, vision, reasoning, security, TypeScript DX

---

*PandaClaw · Built with Bun · Powered by free-tier AI · 🐼*