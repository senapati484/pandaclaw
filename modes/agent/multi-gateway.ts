// modes/agent/multi-gateway.ts
// MultiGateway — the top-level runtime that ties channels to the AgentRouter.
// One process, one set of channel adapters (so we don't spawn 3 Telegram bots),
// but many isolated agents each handling their bound traffic.

import { readConfig } from "../../ai/ai.config.js";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "../gateway/channel-adapter.js";
import type { AgentDefinition, RoutingDecision } from "./agent-types.js";
import { AgentRegistry } from "./agent-registry.js";
import { AgentRouter } from "./agent-router.js";
import { purple, PANDA } from "../../utils/brand.js";
import chalk from "chalk";

export type AgentMessageHandler = (
  agent: AgentDefinition,
  msg: InboundMessage
) => Promise<OutboundMessage | null>;

export interface MultiGatewayOptions {
  /**
   * Custom handler invoked for each routed message. If omitted, the gateway
   * records the routing decision and replies with a stub. Use this to plug
   * in your own agent execution logic.
   */
  handler?: AgentMessageHandler;
  /**
   * Whether to print routing decisions to the console. Defaults to true.
   */
  verbose?: boolean;
}

export class MultiGateway {
  readonly registry: AgentRegistry;
  readonly router: AgentRouter;
  private adapters: Map<string, ChannelAdapter> = new Map();
  private handler: AgentMessageHandler | null = null;
  private verbose: boolean;

  constructor(
    adapters: ChannelAdapter[],
    private readonly config = readConfig(),
    options: MultiGatewayOptions = {}
  ) {
    this.registry = new AgentRegistry((config as any).agents ?? null);
    this.router = new AgentRouter(this.registry);
    this.handler = options.handler ?? null;
    this.verbose = options.verbose ?? true;

    for (const adapter of adapters) {
      this.adapters.set(adapter.platform, adapter);
    }
  }

  // ============ Adapter management ============

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.platform, adapter);
    adapter.onMessage(async (msg) => this.dispatch(adapter, msg));
  }

  getAdapter(platform: string): ChannelAdapter | undefined {
    return this.adapters.get(platform);
  }

  listAdapters(): ChannelAdapter[] {
    return Array.from(this.adapters.values());
  }

  // ============ Lifecycle ============

  async start(channels?: string[]): Promise<void> {
    if (this.verbose) {
      console.log(purple(`\n${PANDA} Multi-agent Gateway starting...`));
      const agents = this.registry.list();
      console.log(chalk.gray(`  📋 ${agents.length} agent${agents.length === 1 ? "" : "s"}:`));
      for (const a of agents) {
        const bindingStr = a.bindings.map((b) => b.raw).join(", ") || "(no bindings)";
        const tag = a.isDefault ? chalk.yellow(" [default]") : "";
        console.log(chalk.gray(`     • ${a.id}${tag} → [${bindingStr}] @ ${a.workspacePath}`));
      }
    }
    for (const [name, adapter] of this.adapters) {
      if (channels && !channels.includes(name)) continue;
      try {
        await adapter.start();
        adapter.onMessage(async (msg) => this.dispatch(adapter, msg));
        if (this.verbose) {
          console.log(chalk.gray(`  ⚡ Loaded channel: [${name}]`));
        }
      } catch (err: any) {
        if (this.verbose) {
          console.log(chalk.red(`  ❌ Failed to load channel [${name}]: ${err.message}`));
        }
      }
    }
  }

  async stop(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.stop();
      } catch {}
    }
  }

  // ============ Routing ============

  /**
   * Manually route a single message (useful for testing or webhook handlers
   * that don't go through a channel adapter).
   */
  async dispatch(adapter: ChannelAdapter, msg: InboundMessage): Promise<OutboundMessage | null> {
    const decision = this.router.route(adapter.platform, msg.chatId);
    if (this.verbose) {
      const badge = decision.matchedBinding?.raw ?? "(default)";
      console.log(
        purple(
          `\n${PANDA} [${adapter.platform}:${msg.chatId}] → agent "${decision.agent.id}" (${badge})`
        )
      );
    }

    if (!this.handler) {
      // No handler installed — return a stub so the caller knows routing worked.
      return {
        text: `${PANDA} [${decision.agent.id}] received: ${msg.text ?? "(no text)"}`,
        parseMode: "Markdown",
      };
    }

    try {
      const reply = await this.handler(decision.agent, msg);
      if (reply) {
        await adapter.send({ channelId: msg.chatId }, reply);
      }
      return reply;
    } catch (err: any) {
      if (this.verbose) {
        console.error(chalk.red(`[MultiGateway error] ${err.message}`));
      }
      return { text: `❌ Error: ${err.message}`, parseMode: "Markdown" };
    }
  }

  /**
   * Returns the routing decision for a given (platform, chatId) without
   * actually dispatching. Useful for debugging and the dashboard.
   */
  explain(platform: string, chatId: string): RoutingDecision {
    return this.router.route(platform, chatId);
  }

  health(): Record<string, { ok: boolean; error?: string }> {
    const result: Record<string, { ok: boolean; error?: string }> = {};
    for (const [name, adapter] of this.adapters) {
      const h = adapter.health();
      result[name] = { ok: h.ok, error: h.error };
    }
    return result;
  }
}
