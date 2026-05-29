// modes/ask/orchestrator.ts
// Ask Mode CLI loop — classifies input, routes to fast-path or panda-mode

import chalk from "chalk";
import { createInterface } from "readline";
import type { AskTask, AskResult } from "../../modes/agent/types.js";
import { classifyTask } from "./classifier.js";
import { runFastPath } from "./fast-path.js";
import { runPandaMode } from "./panda-mode.js";
import { readConfig } from "../../ai/ai.config.js";
import { saveToMemory } from "../../memory/store.js";

const PANDA = chalk.hex("#5b4d9e");
const FACE  = chalk.hex("#e8dcf8");

export async function runAskMode(): Promise<void> {
  const config = readConfig();

  console.log(PANDA("\n🐼 Ask Mode — I think before I answer\n"));
  console.log(FACE("  Simple questions → instant answer (Groq fast-path)"));
  console.log(FACE("  Hard questions   → panda mode (DeepSeek R1 + verify)\n"));
  console.log(chalk.gray("  Type 'exit' to return to main menu\n"));

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

      const taskType = classifyTask(trimmed);

      // Build task object
      const task: AskTask = {
        id: crypto.randomUUID(),
        type: taskType,
        input: trimmed,
        conversationHistory: [...conversationHistory],
        createdAt: new Date(),
      };

      // Thinking indicator for panda mode
      if (taskType === "complex") {
        process.stdout.write(PANDA("  🐼 thinking deeply...\r"));
      } else {
        process.stdout.write(chalk.gray("  ⚡ ...\r"));
      }

      const start = Date.now();
      let result: AskResult;

      try {
        result =
          taskType === "complex"
            ? await runPandaMode(task, config)
            : await runFastPath(task, config);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write("                          \r");
        console.log(chalk.red(`\n  ❌ Error: ${msg}\n`));
        promptUser();
        return;
      }

      // Clear indicator
      process.stdout.write("                          \r");
      console.log();

      // Mode badge
      if (taskType === "complex") {
        console.log(
          PANDA(
            `  🐼 panda mode · ${result.durationMs}ms · ${result.provider}` +
              (result.verified ? " · verified ✓" : "")
          )
        );
      } else {
        console.log(chalk.gray(`  ⚡ fast · ${result.durationMs}ms · ${result.provider}`));
      }

      console.log();
      console.log(FACE("PandaClaw: ") + result.answer);
      console.log();

      // Update conversation history
      conversationHistory.push({ role: "user", content: trimmed });
      conversationHistory.push({ role: "assistant", content: result.answer });

      // Persist to memory
      try {
        saveToMemory({
          id: task.id,
          timestamp: Date.now(),
          role: "user",
          content: trimmed,
          importance: taskType === "complex" ? "high" : "low",
        });
      } catch {
        // Memory save errors are non-fatal
      }

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

