import { readConfig } from "../../ai/ai.config.js";
import { saveToMemory, saveChatMessage } from "../../memory/store.js";
import { runVisionPipeline } from "../../vision/index.js";
import type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
} from "./channel-adapter.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { SlackAdapter } from "./adapters/slack.js";
import { WebChatAdapter } from "./adapters/webchat.js";
import type { ToolContext } from "../../modes/agent/types.js";
import { runToolAgent } from "../ask/tool-agent.js";
import { classifyRoute } from "../ask/classifier.js";
import type { AgentDefinition } from "../agent/agent-types.js";
import { MultiGateway, type AgentMessageHandler } from "../agent/multi-gateway.js";
import { purple, PANDA } from "../../utils/brand.js";
import chalk from "chalk";

const CONSOLIDATE_EVERY_N_MESSAGES = 3;

export class Gateway {
  private config = readConfig();
  private messageHandler: ((msg: InboundMessage) => Promise<OutboundMessage | null>) | null = null;
  private messageCounter = 0;
  private multi: MultiGateway;
  private _adapters: Map<string, ChannelAdapter> = new Map();

  constructor(handler?: AgentMessageHandler) {
    const adapters: ChannelAdapter[] = [];
    try {
      adapters.push(new TelegramAdapter(this.config));
    } catch {}
    adapters.push(new SlackAdapter(this.config));
    adapters.push(new WebChatAdapter());

    for (const a of adapters) this._adapters.set(a.platform, a);

    const defaultHandler: AgentMessageHandler = handler ?? (async (agent, msg) => {
      if (this.messageHandler) return await this.messageHandler(msg);
      return await this.defaultRouteMessage(agent, msg);
    });

    this.multi = new MultiGateway(adapters, this.config, { handler: defaultHandler });
  }

  public getAdapter(name: string): ChannelAdapter | undefined {
    return this._adapters.get(name);
  }

  public register(adapter: ChannelAdapter): void {
    this.multi.register(adapter);
    this._adapters.set(adapter.platform, adapter);
  }

  public onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): void {
    this.messageHandler = handler;
  }

  public async start(channels?: string[]): Promise<void> {
    console.log(purple(`\n${PANDA} Starting PandaClaw Gateway...`));
    await this.multi.start(channels);
  }

  public async stop(): Promise<void> {
    await this.multi.stop();
  }

  public async broadcast(message: OutboundMessage, sourcePlatform?: string): Promise<void> {
    for (const [platform, adapter] of this._adapters) {
      if (platform === sourcePlatform) continue;
      try {
        await adapter.send({ channelId: "*" }, message);
      } catch {}
    }
  }

  public health(): Record<string, { ok: boolean; error?: string }> {
    return this.multi.health();
  }

  // ============ Default per-message handler ============

  private async handleVisionMessage(msg: InboundMessage): Promise<OutboundMessage | null> {
    try {
      const result = await runVisionPipeline(msg.photoBuffer!, msg.mimeType!, msg.text ?? "Describe this image");
      let text = `${PANDA} *Vision Analysis*\n_Type: ${result.contentType}_\n\n`;

      switch (result.action.type) {
        case "describe":   text += result.action.summary; break;
        case "diagnose":   text += `*Issue:* ${result.action.issue}\n\n*Fix:* ${result.action.fix}`; break;
        case "navigate":   text += result.action.instruction; break;
        case "code_review": text += result.action.findings.map((f) => `• ${f.message}`).join("\n"); break;
        case "extract":    text += "```json\n" + JSON.stringify(result.action.data, null, 2) + "\n```"; break;
        default:           text += JSON.stringify(result.action);
      }

      return { text, parseMode: "Markdown" };
    } catch (err: any) {
      return { text: `❌ Vision Error: ${err.message}` };
    }
  }

  private async handleGatewayCommand(userText: string): Promise<OutboundMessage | null> {
    if (userText === "/start") {
      return {
        text:
          `${PANDA} *PandaClaw Agent is online!*\n\n` +
          `I have *direct access* to your local machine:\n` +
          `• 📁 Read \& write files\n` +
          `• 📂 List directories\n` +
          `• ⚡ Run code \& commands\n` +
          `• 🔍 Search the web\n` +
          `• 👁 Analyze images\n\n` +
          `Just tell me what to do — I'll do it!`,
        parseMode: "Markdown",
      };
    }

    if (userText === "/help") {
      return {
        text:
          `${PANDA} *PandaClaw Help*\n\n` +
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
          `*/status* - show machine info`,
        parseMode: "Markdown",
      };
    }

    if (userText === "/status") {
      const cwd = process.cwd();
      const p = this.config.providers as Record<string, { api_key?: string; api_base?: string } | undefined>;
      const providerLines = Object.entries(p)
        .map(([name, cfg]) => `• ${name}: ${cfg?.api_key || cfg?.api_base ? "✅" : "❌"}`)
        .join("\n");
      return {
        text: `${PANDA} *PandaClaw Status*\n\n• Workspace: \`${cwd}\`\n${providerLines}`,
        parseMode: "Markdown",
      };
    }

    return null;
  }

  private async runAgentRoute(
    userText: string,
    route: string,
    toolCtx: ToolContext
  ): Promise<{ answer: string; toolsUsed: string[]; durationMs: number }> {
    if (route === "action") {
      return await runToolAgent(userText, this.config, toolCtx);
    }

    if (route === "complex") {
      const { runPandaMode } = await import("../ask/panda-mode.js");
      const task = {
        id: crypto.randomUUID(),
        type: "complex" as const,
        input: userText,
        conversationHistory: [],
        createdAt: new Date(),
      };
      const pandaResult = await runPandaMode(task, this.config);
      return {
        answer: pandaResult.answer,
        toolsUsed: [],
        durationMs: pandaResult.durationMs,
      };
    }

    const { runFastPath } = await import("../ask/fast-path.js");
    const task = {
      id: crypto.randomUUID(),
      type: "simple" as const,
      input: userText,
      conversationHistory: [],
      createdAt: new Date(),
    };
    const fastResult = await runFastPath(task, this.config);
    const result = {
      answer: fastResult.answer,
      toolsUsed: [] as string[],
      durationMs: fastResult.durationMs,
    };

    try {
      saveChatMessage(toolCtx.userId ?? "unknown", "user", userText);
      saveChatMessage(toolCtx.userId ?? "unknown", "assistant", result.answer);
    } catch {}

    return result;
  }

  private async executeAgentRoute(adapter: ChannelAdapter, msg: InboundMessage, agent?: AgentDefinition): Promise<OutboundMessage | null> {
    const userText = msg.text!;
    const channelName = adapter.platform;
    const toolCtx: ToolContext = {
      userId: msg.senderId,
      channel: channelName as ToolContext["channel"],
      workspacePath: agent?.workspacePath ?? "/",
      requestConsent: async () => true,
    };

    try {
      console.log(purple(`\n${PANDA} [${adapter.platform}] ${msg.senderName}: ${userText.slice(0, 80)}`));

      const route = classifyRoute(userText);
      console.log(chalk.gray(`  Route: ${route}`));

      const result = await this.runAgentRoute(userText, route, toolCtx);

      const toolBadge =
        result.toolsUsed.length > 0
          ? `\n\n_🔧 tools: ${result.toolsUsed.join(", ")} · ${result.durationMs}ms_`
          : `\n\n_⚡ ${result.durationMs}ms_`;

      this.messageCounter++;
      if (this.messageCounter % CONSOLIDATE_EVERY_N_MESSAGES === 0) {
        const { MemoryConsolidator } = await import("../../memory/consolidator.js");
        const consolidator = new MemoryConsolidator(process.cwd());
        consolidator.consolidate(this.config)
          .then((summary) => console.log(chalk.gray(`  🐼 [Memory Background Consolidator] ${summary}`)))
          .catch((err) => console.error(chalk.red(`  🐼 [Memory Background Consolidator Error] ${err.message}`)));
      }

      try {
        saveToMemory({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          role: "user",
          content: userText,
          importance: result.toolsUsed.length > 0 ? "high" : "low",
        });
      } catch {}

      return { text: result.answer + toolBadge, parseMode: "Markdown" };
    } catch (err: any) {
      const raw: string = err.message ?? "";
      let friendly = `❌ Error: ${raw || "Unknown error occurred"}`;
      if (raw.includes("429") || raw.toLowerCase().includes("rate limit")) {
        friendly = "⏳ *Rate limit hit* — AI providers are busy. Please wait a moment!";
      } else if (raw.includes("All providers failed") || raw.toLowerCase().includes("unreachable")) {
        friendly = "🌐 *All AI providers unreachable.* Check your internet or API keys.";
      }
      console.error(chalk.red(`[Gateway error] ${raw}`));
      return { text: friendly, parseMode: "Markdown" };
    }
  }

  private async defaultRouteMessage(agent: AgentDefinition, msg: InboundMessage): Promise<OutboundMessage | null> {
    // Use the first registered adapter for platform name. The actual reply delivery
    // is handled by MultiGateway.dispatch, which knows the originating adapter.
    const adapter = this._findAdapterForAgent(agent) ?? Array.from(this._adapters.values())[0];
    if (msg.photoBuffer && msg.mimeType) {
      return await this.handleVisionMessage(msg);
    }
    if (msg.text) {
      const cmd = await this.handleGatewayCommand(msg.text);
      if (cmd) return cmd;
      if (adapter) {
        return await this.executeAgentRoute(adapter, msg, agent);
      }
    }
    return null;
  }

  private _findAdapterForAgent(agent: AgentDefinition): ChannelAdapter | undefined {
    for (const binding of agent.bindings) {
      const a = this._adapters.get(binding.platform);
      if (a) return a;
    }
    return undefined;
  }
}
