import { readConfig } from "../../ai/ai.config.js";
import { saveToMemory } from "../../memory/store.js";
import { classifyTask } from "../ask/classifier.js";
import { runFastPath } from "../ask/fast-path.js";
import { runPandaMode } from "../ask/panda-mode.js";
import { runVisionPipeline } from "../../vision/index.js";
import type { ChannelAdapter, ChannelMessage } from "./adapter.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { SlackAdapter } from "./adapters/slack.js";
import { WebChatAdapter } from "./adapters/webchat.js";
import type { AskTask } from "../../modes/agent/types.js";
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

    if (msg.photoBuffer && msg.mimeType) {
      try {
        const result = await runVisionPipeline(msg.photoBuffer, msg.mimeType, msg.text ?? "Describe this image");
        let reply = `🐼 *Vision Analysis*\n_Type: ${result.contentType}_\n\n`;

        switch (result.action.type) {
          case "describe":
            reply += result.action.summary;
            break;
          case "diagnose":
            reply += `*Issue:* ${result.action.issue}\n\n*Fix:* ${result.action.fix}`;
            break;
          case "navigate":
            reply += result.action.instruction;
            break;
          case "code_review":
            reply += result.action.findings.map((f) => `• ${f.message}`).join("\n");
            break;
          case "extract":
            reply += "```json\n" + JSON.stringify(result.action.data, null, 2) + "\n```";
            break;
          default:
            reply += JSON.stringify(result.action);
        }

        await adapter.sendMessage(chatId, reply);
      } catch (err: any) {
        await adapter.sendMessage(chatId, `❌ Vision Error: ${err.message}`);
      }
      return;
    }

    if (msg.text) {
      const userText = msg.text;

      if (userText === "/start" || userText === "/help") {
        await adapter.sendMessage(
          chatId,
          `🐼 *PandaClaw v3 is online!*\n\n` +
            `• Simple questions → fast-path\n` +
            `• Complex logic → deep-reasoning (panda-mode)\n` +
            `• Send photo → visual-native analysis\n` +
            `• Web interface → local interactive canvas`
        );
        return;
      }

      try {
        const taskType = classifyTask(userText);
        const task: AskTask = {
          id: crypto.randomUUID(),
          type: taskType,
          input: userText,
          conversationHistory: [],
          createdAt: new Date(),
        };

        const result =
          taskType === "complex"
            ? await runPandaMode(task, this.config)
            : await runFastPath(task, this.config);

        const footer =
          taskType === "complex"
            ? `\n\n_🐼 panda mode · ${result.durationMs}ms${result.verified ? " · verified ✓" : ""}_`
            : `\n\n_⚡ fast · ${result.durationMs}ms_`;

        await adapter.sendMessage(chatId, result.answer + footer);

        try {
          saveToMemory({
            id: task.id,
            timestamp: Date.now(),
            role: "user",
            content: userText,
            importance: taskType === "complex" ? "high" : "low",
          });
        } catch {}
      } catch (err: any) {
        await adapter.sendMessage(chatId, `❌ Error: ${err.message}`);
      }
    }
  }
}
