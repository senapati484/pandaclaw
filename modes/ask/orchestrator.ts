import chalk from "chalk";
import { text, isCancel } from "@clack/prompts";
import { randomUUID } from "crypto";
import type { AskSession, AskMessage } from "./types";
import { CodebaseContextManager } from "../agent/context-manager";
import { ModelSelector } from "../agent/model-selector";

export class AskOrchestrator {
  private session: AskSession;
  private contextManager: CodebaseContextManager;

  constructor() {
    this.session = {
      sessionId: randomUUID(),
      createdAt: new Date(),
      history: []
    };
    this.contextManager = new CodebaseContextManager(process.cwd());
  }

  async initializeSession(): Promise<void> {
    await this.contextManager.indexCodebase();
  }

  /**
   * Respond to a direct user question.
   * Leverages codebase framework and structure details to customize responses.
   */
  async askQuestion(question: string, modelSelector?: ModelSelector): Promise<string> {
    const qLower = question.toLowerCase();
    const index = this.contextManager.getIndex();
    const frameworks = index.frameworks.join(", ") || "none";
    const filesCount = index.files.size;

    const userMessage: AskMessage = {
      id: randomUUID(),
      role: "user",
      content: question,
      timestamp: new Date()
    };
    this.session.history.push(userMessage);

    let answer = "";
    let useLLM = false;

    if (modelSelector) {
      try {
        const config = await modelSelector.selectModel("analysis");
        if (config.provider === "groq" || config.provider === "openrouter") {
          useLLM = true;
        }
      } catch (e) {
        // Fall back
      }
    }

    if (useLLM && modelSelector) {
      const prompt = `You are PandaClaw, an assistant answering questions about the user's codebase.
Question: "${question}"
Codebase Path: "${this.contextManager.codebasePath}"
Frameworks detected: ${frameworks}
Total files tracked: ${filesCount}
Files details:
${JSON.stringify(Array.from(index.files.keys()).slice(0, 100), null, 2)}
Conversation History:
${JSON.stringify(this.session.history.slice(-10), null, 2)}

Provide a concise, helpful, and technically accurate response. Do not guess. If you do not know, say so.`;

      try {
        answer = await modelSelector.generateText("analysis", prompt);
      } catch (e) {
        console.error(chalk.red("LLM query failed in Ask Mode, using fallback:"), e);
      }
    }

    if (!answer) {
      // Pattern matching logic to simulate conversation with project awareness
      if (qLower.includes("framework") || qLower.includes("technology")) {
        answer = `PandaClaw inspected your codebase and detected the following frameworks/technologies: ${frameworks}.`;
      } else if (qLower.includes("files") || qLower.includes("codebase") || qLower.includes("size")) {
        answer = `PandaClaw is tracking ${filesCount} files in this workspace directory, with detected patterns: ${index.patterns.join(", ") || "none"}.`;
      } else if (qLower.includes("hello") || qLower.includes("hi")) {
        answer = "Hello! I am PandaClaw. How can I help you with your codebase today?";
      } else if (qLower.includes("help")) {
        answer = "I can analyze your codebase frameworks, file counts, and patterns. Ask me about your 'frameworks' or 'files' for detail.";
      } else {
        answer = `I analyzed your query: "${question}". Since I'm running in local offline mode, here is what I know: Your workspace has ${filesCount} files and detected frameworks: [${frameworks}]. Let me know if you want me to plan any modifications!`;
      }
    }

    const assistantMessage: AskMessage = {
      id: randomUUID(),
      role: "assistant",
      content: answer,
      timestamp: new Date()
    };
    this.session.history.push(assistantMessage);

    return answer;
  }

  getSessionHistory(): AskMessage[] {
    return this.session.history;
  }
}

/**
 * CLI Runner for Ask Mode
 */
export async function runAskMode(): Promise<void> {
  console.log(chalk.cyan("\n🐼 Welcome to Ask Mode!\n"));

  const orchestrator = new AskOrchestrator();
  await orchestrator.initializeSession();

  const modelSelector = new ModelSelector();

  while (true) {
    const question = await text({
      message: "Ask PandaClaw a question (or press Enter to exit)",
      placeholder: "e.g. What frameworks are detected?"
    });

    if (isCancel(question) || !question.trim()) {
      break;
    }

    const response = await orchestrator.askQuestion(question.trim(), modelSelector);
    console.log(chalk.green(`\n🐼 Response:\n${response}\n`));
  }

  console.log(chalk.cyan("Thanks for using Ask Mode! 🐼\n"));
}
