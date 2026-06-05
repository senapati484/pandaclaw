import type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
  ChannelRecipient,
  ChannelHealth,
} from "../channel-adapter.js";
import type { PandaConfig } from "../../../ai/ai.config.js";

export class SlackAdapter implements ChannelAdapter {
  public readonly name = "SlackAdapter";
  public readonly platform = "slack" as const;

  private config: PandaConfig;
  private messageHandler: ((msg: InboundMessage) => Promise<OutboundMessage | null>) | null = null;
  private started = false;

  constructor(config: PandaConfig) {
    this.config = config;
  }

  public async start(): Promise<void> {
    this.started = true;
  }

  public async stop(): Promise<void> {
    this.started = false;
  }

  public async send(recipient: ChannelRecipient, message: OutboundMessage): Promise<void> {
    const webhookUrl = this.config.slack?.webhook_url || process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.log(`[Slack Mock Send] To ${recipient.channelId}: ${message.text}`);
      return;
    }

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.text, channel: recipient.channelId }),
      });
    } catch (err: any) {
      console.error("Slack post request failed:", err.message);
    }
  }

  public onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): void {
    this.messageHandler = handler;
  }

  public async handleWebhookEvent(event: any): Promise<void> {
    if (!this.messageHandler) return;

    if (event.type === "message" && !event.bot_id) {
      const inbound: InboundMessage = {
        id: event.client_msg_id || Math.random().toString(),
        senderId: event.user || "unknown_slack_user",
        senderName: event.user_name || "Slack User",
        text: event.text || "",
        chatId: event.channel || "general",
      };
      await this.messageHandler(inbound);
    }
  }

  public health(): ChannelHealth {
    return { ok: this.started };
  }
}
