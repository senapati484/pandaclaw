// tests/multi-gateway.test.ts
// Verifies the top-level MultiGateway wires channels to the AgentRouter.

import { describe, expect, test, beforeEach } from "bun:test";
import { MultiGateway, type AgentMessageHandler } from "../modes/agent/multi-gateway.ts";
import { AgentRegistry } from "../modes/agent/agent-registry.ts";
import { AgentRouter } from "../modes/agent/agent-router.ts";
import type { ChannelAdapter, InboundMessage, OutboundMessage, ChannelHealth, Platform } from "../modes/gateway/channel-adapter.ts";
import type { AgentDefinition } from "../modes/agent/agent-types.ts";

class MockAdapter implements ChannelAdapter {
  readonly platform: Platform;
  readonly name: string;
  public started = false;
  public sent: Array<{ recipient: any; message: OutboundMessage }> = [];
  private handler: ((msg: InboundMessage) => Promise<OutboundMessage | null>) | null = null;

  constructor(platform: Platform) {
    this.platform = platform;
    this.name = `Mock${platform}`;
  }

  async start() { this.started = true; }
  async stop() { this.started = false; }
  async send(recipient: any, message: OutboundMessage): Promise<void> {
    this.sent.push({ recipient, message });
  }
  onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): void {
    this.handler = handler;
  }
  health(): ChannelHealth { return { ok: this.started }; }

  /** Test helper: simulate an inbound message */
  async inject(msg: { id?: string; senderId?: string; senderName?: string; text?: string; chatId: string }): Promise<OutboundMessage | null> {
    const fullMsg: InboundMessage = {
      id: msg.id ?? crypto.randomUUID(),
      senderId: msg.senderId ?? "u1",
      senderName: msg.senderName ?? "Alice",
      text: msg.text,
      chatId: msg.chatId,
    };
    if (!this.handler) throw new Error("No handler registered");
    return this.handler(fullMsg);
  }
}

describe("MultiGateway", () => {
  let telegram: MockAdapter;
  let slack: MockAdapter;

  beforeEach(() => {
    telegram = new MockAdapter("telegram");
    slack = new MockAdapter("slack");
  });

  function makeGateway(handler?: AgentMessageHandler): MultiGateway {
    const gw = new MultiGateway(
      [telegram, slack],
      {
        agents: {
          default: "main",
          list: [
            { id: "main", bindings: ["telegram:*", "slack:*"] },
            { id: "ops", bindings: ["telegram:-100OPS", "slack:C0OPS"] },
            { id: "work", bindings: ["telegram:-100WORK"] },
          ],
        },
      } as any,
      { handler, verbose: false }
    );
    return gw;
  }

  test("routes an inbound message to the correct agent and sends the reply", async () => {
    const seen: Array<{ agent: AgentDefinition; msg: InboundMessage }> = [];
    const gw = makeGateway(async (agent, msg) => {
      seen.push({ agent, msg });
      return { text: `hello from ${agent.id}`, parseMode: "Markdown" };
    });
    await gw.start();

    await telegram.inject({ chatId: "-100OPS", text: "ping" });
    expect(seen.length).toBe(1);
    expect(seen[0]!.agent.id).toBe("ops");
    expect(telegram.sent.length).toBe(1);
    expect(telegram.sent[0]!.message.text).toBe("hello from ops");

    await telegram.inject({ chatId: "-100OTHER", text: "default here" });
    expect(seen.length).toBe(2);
    expect(seen[1]!.agent.id).toBe("main");

    await slack.inject({ chatId: "C0OPS", text: "ops on slack" });
    expect(seen.length).toBe(3);
    expect(seen[2]!.agent.id).toBe("ops");
  });

  test("falls back to default agent when no binding matches", async () => {
    const seen: AgentDefinition[] = [];
    const gw = makeGateway(async (agent) => {
      seen.push(agent);
      return { text: "ok" };
    });
    await gw.start();
    // Inject from a platform that has no bindings at all
    const discord = new MockAdapter("discord");
    gw.register(discord);
    await discord.inject({ chatId: "any", text: "hi" });
    expect(seen[0]!.id).toBe("main");
  });

  test("returns a routing decision via explain()", async () => {
    const gw = makeGateway();
    const decision = gw.explain("telegram", "-100WORK");
    expect(decision.agent.id).toBe("work");
    expect(decision.reason).toBe("exact");
  });

  test("health() reports each adapter's status", async () => {
    const gw = makeGateway();
    await gw.start();
    const h = gw.health();
    expect(h.telegram?.ok).toBe(true);
    expect(h.slack?.ok).toBe(true);
  });

  test("listAdapters() returns all registered adapters", () => {
    const gw = makeGateway();
    expect(gw.listAdapters().length).toBe(2);
    const discord = new MockAdapter("discord");
    gw.register(discord);
    expect(gw.listAdapters().length).toBe(3);
  });

  test("handler error is caught and reported back to the channel", async () => {
    const gw = makeGateway(async () => {
      throw new Error("boom");
    });
    await gw.start();
    const reply = await telegram.inject({ chatId: "-100OPS", text: "hi" });
    expect(reply?.text).toMatch(/❌ Error/);
    expect(reply?.text).toContain("boom");
  });

  test("stop() stops all adapters", async () => {
    const gw = makeGateway();
    await gw.start();
    expect(telegram.started).toBe(true);
    await gw.stop();
    expect(telegram.started).toBe(false);
  });
});
