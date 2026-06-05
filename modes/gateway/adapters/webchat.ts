import type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
  ChannelRecipient,
  ChannelHealth,
} from "../channel-adapter.js";

export class WebChatAdapter implements ChannelAdapter {
  public readonly name = "WebChatAdapter";
  public readonly platform = "webchat" as const;

  private messageHandler: ((msg: InboundMessage) => Promise<OutboundMessage | null>) | null = null;
  private pendingReplies = new Map<string, (text: string) => void>();
  private started = false;

  public async start(): Promise<void> {
    this.started = true;
  }

  public async stop(): Promise<void> {
    this.started = false;
  }

  public async send(recipient: ChannelRecipient, message: OutboundMessage): Promise<void> {
    const resolver = this.pendingReplies.get(recipient.channelId);
    if (resolver) {
      resolver(message.text);
      this.pendingReplies.delete(recipient.channelId);
    }
  }

  public onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): void {
    this.messageHandler = handler;
  }

  public async handleUserMessage(text: string, chatId: string = "web_default"): Promise<string> {
    if (!this.messageHandler) {
      return "WebChat adapter is offline.";
    }

    const inbound: InboundMessage = {
      id: crypto.randomUUID(),
      senderId: "web_user",
      senderName: "Web User",
      text,
      chatId,
    };

    return new Promise<string>(async (resolve) => {
      this.pendingReplies.set(chatId, resolve);
      try {
        const reply = await this.messageHandler!(inbound);
        if (reply) {
          await this.send({ channelId: chatId }, reply);
        } else {
          resolve("");
        }
      } catch (err: any) {
        resolve(`Error: ${err.message}`);
      }
    });
  }

  public health(): ChannelHealth {
    return { ok: this.started };
  }
}
