import type { ChannelAdapter, ChannelMessage } from "../adapter.js";

export class WebChatAdapter implements ChannelAdapter {
  public name = "webchat";
  private messageCallback: ((msg: ChannelMessage) => Promise<void>) | null = null;
  private pendingReplies = new Map<string, (text: string) => void>();

  public async initialize(): Promise<void> {
    // WebChat adapter initialized
  }

  public async stop(): Promise<void> {
    // WebChat adapter stopped
  }

  public async sendMessage(chatId: string, text: string): Promise<void> {
    const resolver = this.pendingReplies.get(chatId);
    if (resolver) {
      resolver(text);
      this.pendingReplies.delete(chatId);
    }
  }

  public onMessage(callback: (msg: ChannelMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }

  public async handleUserMessage(text: string, chatId: string = "web_default"): Promise<string> {
    if (!this.messageCallback) {
      return "WebChat adapter is offline.";
    }

    const channelMsg: ChannelMessage = {
      id: crypto.randomUUID(),
      senderId: "web_user",
      senderName: "Web User",
      text,
      chatId,
    };

    return new Promise<string>((resolve) => {
      this.pendingReplies.set(chatId, resolve);
      this.messageCallback!(channelMsg).catch((err: any) => {
        resolve(`Error: ${err.message}`);
      });
    });
  }
}
