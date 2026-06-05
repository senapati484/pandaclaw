// modes/ask/orchestrator.ts
// Ask Mode CLI loop — classifies input, routes to fast-path or panda-mode

import chalk from "chalk";
import { createInterface } from "readline";
import type { AskTask, AskResult, ToolContext } from "../../modes/agent/types.js";
import { classifyRoute } from "./classifier.js";
import { runFastPath } from "./fast-path.js";
import { runPandaMode } from "./panda-mode.js";
import { readConfig } from "../../ai/ai.config.js";
import { saveToMemory } from "../../memory/store.js";

const PANDA = chalk.hex("#5b4d9e");
const FACE  = chalk.hex("#e8dcf8");

function streamAnswer(text: string): void {
  const words = text.split(" ");
  let buf = "";
  for (const w of words) {
    buf += (buf ? " " : "") + w;
    if (buf.length >= 80) {
      process.stdout.write(buf);
      buf = "";
    }
  }
  if (buf) process.stdout.write(buf);
}

function showThinkingIndicator(route: string): void {
  if (route === "complex" || route === "action") {
    process.stdout.write(PANDA("  🐼 thinking\r"));
  } else {
    process.stdout.write(chalk.gray("  ⚡\r"));
  }
}

interface CliRouteResult {
  answer: string;
  durationMs: number;
  provider: string;
  badgeInfo: string;
}

async function handleCliRoute(
  trimmed: string,
  route: string,
  task: AskTask,
  config: any
): Promise<CliRouteResult> {
  if (route === "action") {
    const { runToolAgent } = await import("./tool-agent.js");
    const toolCtx: ToolContext = {
      userId: "local-cli",
      channel: "cli",
      workspacePath: "/",
      requestConsent: async () => true,
    };

    const result = await runToolAgent(trimmed, config, toolCtx);
    const badgeInfo = result.toolsUsed.length > 0 ? ` · tools: ${result.toolsUsed.join(", ")}` : "";
    return {
      answer: result.answer,
      durationMs: result.durationMs,
      provider: "tool-agent",
      badgeInfo,
    };
  }

  if (route === "complex") {
    const result = await runPandaMode(task, config);
    const badgeInfo = result.verified ? " · verified ✓" : "";
    return {
      answer: result.answer,
      durationMs: result.durationMs,
      provider: result.provider,
      badgeInfo,
    };
  }

  // default: simple fast path
  const result = await runFastPath(task, config);
  return {
    answer: result.answer,
    durationMs: result.durationMs,
    provider: result.provider,
    badgeInfo: "",
  };
}

function saveCliMemory(taskId: string, route: string, content: string): void {
  try {
    saveToMemory({
      id: taskId,
      timestamp: Date.now(),
      role: "user",
      content,
      importance: route === "simple" ? "low" : "high",
    });
  } catch {
    // Memory save errors are non-fatal
  }
}

export async function runAskMode(): Promise<void> {
  const config = readConfig();

  console.log(PANDA("\n🐼 Ask Mode\n"));

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  const promptUser = (): void => {
    rl.question(FACE("You: "), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        promptUser();
        return;
      }

      if (trimmed.toLowerCase() === "exit") {
        console.log(PANDA("\nMaybe later, panda...\n"));
        rl.close();
        return;
      }

      const route = classifyRoute(trimmed);

      // Build task object for legacy and reasoning handlers
      const task: AskTask = {
        id: crypto.randomUUID(),
        type: route === "simple" ? "simple" : "complex",
        input: trimmed,
        conversationHistory: [...conversationHistory],
        createdAt: new Date(),
      };

      showThinkingIndicator(route);

      try {
        const result = await handleCliRoute(trimmed, route, task, config);

        process.stdout.write("\x1b[2K\r");
        console.log();
        if (route === "action" || route === "complex") {
          console.log(PANDA(`  🐼 ${route} mode · ${result.durationMs}ms · ${result.provider}${result.badgeInfo}`));
        } else {
          console.log(chalk.gray(`  ⚡ fast · ${result.durationMs}ms · ${result.provider}`));
        }
        console.log();
        process.stdout.write(FACE("PandaClaw: "));
        streamAnswer(result.answer);
        console.log();

        // Update conversation history
        conversationHistory.push({ role: "user", content: trimmed });
        conversationHistory.push({ role: "assistant", content: result.answer });

        saveCliMemory(task.id, route, trimmed);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write("\x1b[2K\r");
        console.log(chalk.red(`\n  ❌ Error: ${msg}\n`));
      }

      console.log();
      promptUser();
    });
  };

  promptUser();

  // Wait for the readline interface to close
  await new Promise<void>((resolve) => rl.on("close", resolve));
}

// ── Backward-compatible class API (used by ask.test.ts) ──

import { randomUUID } from "crypto";
import { CodebaseContextManager } from "../agent/context-manager.js";
import { ModelSelector } from "../agent/model-selector.js";

interface AskMessage { role: "user" | "assistant"; content: string }
interface AskSession { sessionId: string; createdAt: Date; history: AskMessage[] }

export class AskOrchestrator {
  private session: AskSession;
  private contextManager: CodebaseContextManager;

  constructor() {
    this.session = {
      sessionId: randomUUID(),
      createdAt: new Date(),
      history: [],
    };
    this.contextManager = new CodebaseContextManager(process.cwd());
  }

  async initializeSession(): Promise<void> {
    await this.contextManager.indexCodebase();
  }

  async askQuestion(question: string, _modelSelector?: ModelSelector): Promise<string> {
    const qLower = question.toLowerCase();

    this.session.history.push({ role: "user", content: question });

    let response: string;

    if (qLower.includes("framework")) {
      const index = this.contextManager.getCodebaseIndex();
      const frameworks = index?.frameworks?.join(", ") || "none";
      response = `I detected the following frameworks in your project: ${frameworks}.`;
    } else if (qLower.includes("file") || qLower.includes("size")) {
      const index = this.contextManager.getCodebaseIndex();
      const count = index?.files?.size ?? 0;
      response = `PandaClaw is tracking ${count} files in your codebase.`;
    } else if (qLower.includes("help")) {
      response = "I can analyze your codebase frameworks, files, and answer questions about your project.";
    } else if (/\bhi\b|\bhello\b|\bhey\b/.test(qLower)) {
      response = "Hello! I am PandaClaw. How can I help you today?";
    } else {
      response = "I'm not sure how to answer that yet. Try asking about frameworks or files.";
    }

    this.session.history.push({ role: "assistant", content: response });
    return response;
  }

  getSessionHistory(): AskMessage[] {
    return this.session.history;
  }
}
