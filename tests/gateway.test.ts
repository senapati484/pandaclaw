// tests/gateway.test.ts
// Unit tests for gateway message adapters

import { expect, test, describe, mock, spyOn } from "bun:test";
import { SlackAdapter } from "../modes/gateway/adapters/slack.ts";
import type { ChannelMessage } from "../modes/gateway/adapter.ts";

describe("SlackAdapter Gateway Adapter", () => {
  test("initializes and stops cleanly", async () => {
    const mockConfig = {} as any;
    const adapter = new SlackAdapter(mockConfig);
    
    await expect(adapter.initialize()).resolves.toBeUndefined();
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  test("sendMessage logs message when webhook_url is not set", async () => {
    const mockConfig = {} as any;
    const adapter = new SlackAdapter(mockConfig);
    
    const consoleSpy = spyOn(console, "log");
    await adapter.sendMessage("test-chat", "hello slack");
    
    expect(consoleSpy).toHaveBeenCalled();
    const callArgs = consoleSpy.mock.calls[0];
    expect(callArgs?.[0]).toContain("[Slack Mock Send] To test-chat: hello slack");
    consoleSpy.mockRestore();
  });

  test("sendMessage calls fetch when webhook_url is set", async () => {
    const mockConfig = {
      slack: {
        webhook_url: "https://hooks.slack.com/services/mock-webhook"
      }
    } as any;
    const adapter = new SlackAdapter(mockConfig);

    let fetchedUrl = "";
    let fetchOptions: any = null;

    // Temporarily mock global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, options: any) => {
      fetchedUrl = url;
      fetchOptions = options;
      return { ok: true, text: async () => "ok" } as any;
    }) as any;

    await adapter.sendMessage("test-chat", "hello webhook");

    expect(fetchedUrl).toBe("https://hooks.slack.com/services/mock-webhook");
    expect(fetchOptions).not.toBeNull();
    expect(fetchOptions.method).toBe("POST");
    expect(JSON.parse(fetchOptions.body)).toEqual({
      text: "hello webhook",
      channel: "test-chat"
    });

    globalThis.fetch = originalFetch;
  });

  test("handleWebhookEvent invokes messageCallback correctly", async () => {
    const mockConfig = {} as any;
    const adapter = new SlackAdapter(mockConfig);

    let receivedMsg: ChannelMessage | null = null;
    adapter.onMessage(async (msg) => {
      receivedMsg = msg;
    });

    // 1. Non-message event should be ignored
    await adapter.handleWebhookEvent({ type: "reaction_added" });
    expect(receivedMsg).toBeNull();

    // 2. Bot message event should be ignored
    await adapter.handleWebhookEvent({ type: "message", bot_id: "bot123" });
    expect(receivedMsg).toBeNull();

    // 3. User message event should trigger callback
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
