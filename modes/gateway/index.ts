import { readConfig } from "../../ai/ai.config.js";
import { saveToMemory } from "../../memory/store.js";
import { runVisionPipeline } from "../../vision/index.js";
import type { ChannelAdapter, ChannelMessage } from "./adapter.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { SlackAdapter } from "./adapters/slack.js";
import { WebChatAdapter } from "./adapters/webchat.js";
import type { ToolContext } from "../../modes/agent/types.js";
import { runToolAgent } from "../ask/tool-agent.js";
import chalk from "chalk";

export class Gateway {
  private config = readConfig();
  private adapters: Map<string, ChannelAdapter> = new Map();

  constructor() {
    try {
      this.adapters.set("telegram", new TelegramAdapter(this.config));
    } catch {
      // Ignored if telegram configuration is incomplete
    }
    this.adapters.set("slack", new SlackAdapter(this.config));
    this.adapters.set("webchat", new WebChatAdapter());
  }

  public getAdapter(name: string): ChannelAdapter | undefined {
    return this.adapters.get(name);
  }

  public async start(): Promise<void> {
    console.log(chalk.hex("#5b4d9e")("\n🐼 Starting PandaClaw Gateway..."));

    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.initialize();
        console.log(chalk.gray(`  ⚡ Loaded channel: [${name}]`));

        adapter.onMessage(async (msg) => {
          await this.routeMessage(adapter, msg);
        });
      } catch (err: any) {
        console.log(chalk.red(`  ❌ Failed to load channel [${name}]: ${err.message}`));
      }
    }
  }

  public async stop(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }
  }

  private async routeMessage(adapter: ChannelAdapter, msg: ChannelMessage): Promise<void> {
    const chatId = msg.chatId;

    // ── Photo → Vision pipeline ──────────────────────────────────────────
    if (msg.photoBuffer && msg.mimeType) {
      try {
        const result = await runVisionPipeline(msg.photoBuffer, msg.mimeType, msg.text ?? "Describe this image");
        let reply = `🐼 *Vision Analysis*\n_Type: ${result.contentType}_\n\n`;

        switch (result.action.type) {
          case "describe":   reply += result.action.summary; break;
          case "diagnose":   reply += `*Issue:* ${result.action.issue}\n\n*Fix:* ${result.action.fix}`; break;
          case "navigate":   reply += result.action.instruction; break;
          case "code_review": reply += result.action.findings.map((f) => `• ${f.message}`).join("\n"); break;
          case "extract":    reply += "```json\n" + JSON.stringify(result.action.data, null, 2) + "\n```"; break;
          default:           reply += JSON.stringify(result.action);
        }

        await adapter.sendMessage(chatId, reply);
      } catch (err: any) {
        await adapter.sendMessage(chatId, `❌ Vision Error: ${err.message}`);
      }
      return;
    }

    // ── Text → Agentic tool loop ─────────────────────────────────────────
    if (msg.text) {
      const userText = msg.text;

      // /start and /help commands
      if (userText === "/start") {
        await adapter.sendMessage(
          chatId,
          `🐼 *PandaClaw Agent is online!*\n\n` +
            `I have *direct access* to your local machine:\n` +
            `• 📁 Read \& write files\n` +
            `• 📂 List directories\n` +
            `• ⚡ Run code \& commands\n` +
            `• 🔍 Search the web\n` +
            `• 👁 Analyze images\n\n` +
            `Just tell me what to do — I'll do it!`
        );
        return;
      }

      if (userText === "/help") {
        await adapter.sendMessage(
          chatId,
          `🐼 *PandaClaw Help*\n\n` +
            `*File operations:*\n` +
            `  "read testing.txt"\n` +
            `  "write my name to notes.txt"\n` +
            `  "list all files in the project"\n\n` +
            `*Run commands:*\n` +
            `  "run: ls -la"\n` +
            `  "execute: echo hello world"\n\n` +
            `*Search:*\n` +
            `  "search for how to use Bun"\n\n` +
            `*Vision:*\n` +
            `  Send any photo for AI analysis\n\n` +
            `*/start* - restart\n` +
            `*/status* - show machine info`
        );
        return;
      }

      if (userText === "/status") {
        const cwd = process.cwd();
        await adapter.sendMessage(
          chatId,
          `🐼 *PandaClaw Status*\n\n` +
            `• Workspace: \`${cwd}\`\n` +
            `• Groq: ${this.config.providers.groq.api_key ? "✅" : "❌"}\n` +
            `• OpenRouter: ${this.config.providers.openrouter.api_key ? "✅" : "❌"}\n` +
            `• Nvidia NIM: ${this.config.providers.nvidia_nim.api_key ? "✅" : "❌"}\n` +
            `• Telegram: ✅ connected`
        );
        return;
      }

      // ── Build a ToolContext for this Telegram user (full device access) ─
      const toolCtx: ToolContext = {
        userId: msg.senderId,
        channel: "telegram",
        workspacePath: "/",          // ← entire device, not just pandaclaw dir
        requestConsent: async () => true, // paired user is pre-authorized
      };

      try {
        // Log to console
        console.log(chalk.hex("#5b4d9e")(`\n🐼 [Telegram] ${msg.senderName}: ${userText.slice(0, 80)}`));

        // Classify the task type (simple vs complex)
        const { classifyTask } = await import("../ask/classifier.js");
        const taskType = classifyTask(userText);

        let result;
        if (taskType === "simple") {
          const { runFastPath } = await import("../ask/fast-path.js");
          const task = {
            id: crypto.randomUUID(),
            type: "simple" as const,
            input: userText,
            conversationHistory: [],
            createdAt: new Date(),
          };
          const fastResult = await runFastPath(task, this.config);
          result = {
            answer: fastResult.answer,
            toolsUsed: [] as string[],
            durationMs: fastResult.durationMs,
          };
        } else {
          result = await runToolAgent(userText, this.config, toolCtx);
        }

        const toolBadge =
          result.toolsUsed.length > 0
            ? `\n\n_🔧 tools: ${result.toolsUsed.join(", ")} · ${result.durationMs}ms_`
            : `\n\n_⚡ ${result.durationMs}ms_`;

        await adapter.sendMessage(chatId, result.answer + toolBadge);

        // Persist to memory
        try {
          saveToMemory({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            role: "user",
            content: userText,
            importance: result.toolsUsed.length > 0 ? "high" : "low",
          });
        } catch {}

      } catch (err: any) {
        const raw: string = err.message ?? "";
        let friendly = `❌ Error: ${raw || "Unknown error occurred"}`;
        if (raw.includes("429") || raw.toLowerCase().includes("rate limit")) {
          friendly = "⏳ *Rate limit hit* — AI providers are busy. Please wait a moment!";
        } else if (raw.includes("All providers failed") || raw.toLowerCase().includes("unreachable")) {
          friendly = "🌐 *All AI providers unreachable.* Check your internet or API keys.";
        }
        console.error(chalk.red(`[Gateway error] ${raw}`));
        await adapter.sendMessage(chatId, friendly);
      }
    }
  }
}
