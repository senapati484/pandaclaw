import type { ChannelAdapter, ChannelMessage } from "../adapter.js";
import type { PandaConfig } from "../../../ai/ai.config.js";

export class SlackAdapter implements ChannelAdapter {
  public name = "slack";
  private config: PandaConfig;
  private messageCallback: ((msg: ChannelMessage) => Promise<void>) | null = null;

  constructor(config: PandaConfig) {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    // Slack adapter initialized
  }

  public async stop(): Promise<void> {
    // Slack adapter stopped
  }

  public async sendMessage(chatId: string, text: string): Promise<void> {
    const webhookUrl = this.config.slack?.webhook_url || process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.log(`[Slack Mock Send] To ${chatId}: ${text}`);
      return;
    }

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, channel: chatId }),
      });
    } catch (err: any) {
      console.error("Slack post request failed:", err.message);
    }
  }

  public onMessage(callback: (msg: ChannelMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }

  public async handleWebhookEvent(event: any): Promise<void> {
    if (!this.messageCallback) return;

    if (event.type === "message" && !event.bot_id) {
      const channelMsg: ChannelMessage = {
        id: event.client_msg_id || Math.random().toString(),
        senderId: event.user || "unknown_slack_user",
        senderName: event.user_name || "Slack User",
        text: event.text || "",
        chatId: event.channel || "general",
      };
      await this.messageCallback(channelMsg);
    }
  }
}
