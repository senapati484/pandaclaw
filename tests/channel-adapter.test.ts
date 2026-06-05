// tests/channel-adapter.test.ts
// Verifies the new ChannelAdapter interface and registry pattern

import { expect, test, describe, spyOn } from "bun:test";
import { SlackAdapter } from "../modes/gateway/adapters/slack.ts";
import { WebChatAdapter } from "../modes/gateway/adapters/webchat.ts";
import { TelegramAdapter } from "../modes/gateway/adapters/telegram.ts";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "../modes/gateway/channel-adapter.ts";

describe("ChannelAdapter interface", () => {
  test("SlackAdapter implements the interface", () => {
    const a: ChannelAdapter = new SlackAdapter({} as any);
    expect(a.name).toBeTruthy();
    expect(a.platform).toBe("slack");
    expect(typeof a.start).toBe("function");
    expect(typeof a.stop).toBe("function");
    expect(typeof a.send).toBe("function");
    expect(typeof a.onMessage).toBe("function");
    expect(typeof a.health).toBe("function");
  });

  test("WebChatAdapter implements the interface", () => {
    const a: ChannelAdapter = new WebChatAdapter();
    expect(a.name).toBeTruthy();
    expect(a.platform).toBe("webchat");
  });

  test("TelegramAdapter implements the interface", () => {
    const a: ChannelAdapter = new TelegramAdapter({} as any);
    expect(a.name).toBeTruthy();
    expect(a.platform).toBe("telegram");
  });

  test("onMessage accepts handlers returning OutboundMessage | null", async () => {
    const adapter = new SlackAdapter({} as any);
    const received: InboundMessage[] = [];

    adapter.onMessage(async (msg) => {
      received.push(msg);
      return { text: "ack", parseMode: "Markdown" };
    });

    await adapter.handleWebhookEvent({
      type: "message",
      user: "U1",
      user_name: "Alice",
      text: "hi",
      channel: "C1"
    });

    expect(received.length).toBe(1);
    expect(received[0]!.senderName).toBe("Alice");
  });

  test("health() reports started status", async () => {
    const adapter = new SlackAdapter({} as any);
    const before = adapter.health();
    expect(before.ok).toBe(false);

    await adapter.start();
    const after = adapter.health();
    expect(after.ok).toBe(true);

    await adapter.stop();
  });

  test("send() routes through the new ChannelRecipient interface", async () => {
    const adapter = new SlackAdapter({
      slack: { webhook_url: "https://hooks.slack.com/test" }
    } as any);

    let captured: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, opts: any) => {
      captured = { url, body: JSON.parse(opts.body) };
      return { ok: true, text: async () => "ok" } as any;
    }) as any;

    await adapter.send({ channelId: "C42" }, { text: "hello", parseMode: "Markdown" });

    expect(captured).not.toBeNull();
    expect(captured.body.channel).toBe("C42");
    expect(captured.body.text).toBe("hello");

    globalThis.fetch = originalFetch;
  });

  test("handleUserMessage is the WebChatAdapter entrypoint", async () => {
    const adapter = new WebChatAdapter();

    adapter.onMessage(async (msg) => {
      return { text: `echo: ${msg.text}` };
    });

    const reply = await adapter.handleUserMessage("ping", "test-chat");
    expect(reply).toBe("echo: ping");
  });
});
