import { expect, test, describe, spyOn } from "bun:test";
import { SlackAdapter } from "../modes/gateway/adapters/slack.ts";
import type { InboundMessage } from "../modes/gateway/channel-adapter.ts";

describe("SlackAdapter Gateway Adapter", () => {
  test("starts and stops cleanly", async () => {
    const mockConfig = {} as any;
    const adapter = new SlackAdapter(mockConfig);

    await expect(adapter.start()).resolves.toBeUndefined();
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  test("send logs message when webhook_url is not set", async () => {
    const mockConfig = {} as any;
    const adapter = new SlackAdapter(mockConfig);

    const consoleSpy = spyOn(console, "log");
    await adapter.send({ channelId: "test-chat" }, { text: "hello slack" });

    expect(consoleSpy).toHaveBeenCalled();
    const callArgs = consoleSpy.mock.calls[0];
    expect(callArgs?.[0]).toContain("[Slack Mock Send] To test-chat: hello slack");
    consoleSpy.mockRestore();
  });

  test("send calls fetch when webhook_url is set", async () => {
    const mockConfig = {
      slack: {
        webhook_url: "https://hooks.slack.com/services/mock-webhook"
      }
    } as any;
    const adapter = new SlackAdapter(mockConfig);

    let fetchedUrl = "";
    let fetchOptions: any = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, options: any) => {
      fetchedUrl = url;
      fetchOptions = options;
      return { ok: true, text: async () => "ok" } as any;
    }) as any;

    await adapter.send({ channelId: "test-chat" }, { text: "hello webhook" });

    expect(fetchedUrl).toBe("https://hooks.slack.com/services/mock-webhook");
    expect(fetchOptions).not.toBeNull();
    expect(fetchOptions.method).toBe("POST");
    expect(JSON.parse(fetchOptions.body)).toEqual({
      text: "hello webhook",
      channel: "test-chat"
    });

    globalThis.fetch = originalFetch;
  });

  test("handleWebhookEvent invokes messageHandler correctly", async () => {
    const mockConfig = {} as any;
    const adapter = new SlackAdapter(mockConfig);

    let receivedMsg: InboundMessage | null = null;
    adapter.onMessage(async (msg) => {
      receivedMsg = msg;
      return null;
    });

    await adapter.handleWebhookEvent({ type: "reaction_added" });
    expect(receivedMsg).toBeNull();

    await adapter.handleWebhookEvent({ type: "message", bot_id: "bot123" });
    expect(receivedMsg).toBeNull();

    await adapter.handleWebhookEvent({
      type: "message",
      client_msg_id: "msg_abc_123",
      user: "U999",
      user_name: "Alice",
      text: "Hi chatbot",
      channel: "C888"
    });

    expect(receivedMsg).not.toBeNull();
    expect(receivedMsg!.id).toBe("msg_abc_123");
    expect(receivedMsg!.senderId).toBe("U999");
    expect(receivedMsg!.senderName).toBe("Alice");
    expect(receivedMsg!.text).toBe("Hi chatbot");
    expect(receivedMsg!.chatId).toBe("C888");
  });
});
