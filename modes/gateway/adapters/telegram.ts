import TelegramBot from "node-telegram-bot-api";
import type { ChannelAdapter, ChannelMessage } from "../adapter.js";
import type { PandaConfig } from "../../../ai/ai.config.js";

export class TelegramAdapter implements ChannelAdapter {
  public name = "telegram";
  private bot: TelegramBot | null = null;
  private config: PandaConfig;
  private messageCallback: ((msg: ChannelMessage) => Promise<void>) | null = null;
  private allowedUsers: number[];

  constructor(config: PandaConfig) {
    this.config = config;
    this.allowedUsers = config.telegram?.allowed_users ?? [];
  }

  public async initialize(): Promise<void> {
    const token = this.config.telegram?.token ?? process.env.TELEGRAM_TOKEN ?? "";
    if (!token) {
      throw new Error("Missing Telegram token");
    }

    this.bot = new TelegramBot(token, { polling: true });

    this.bot.on("photo", async (msg) => {
      if (!this.bot || !this.messageCallback) return;
      if (!msg.from || !this.isAllowed(msg.from.id)) {
        await this.bot.sendMessage(msg.chat.id, "🐼 Sorry, you're not on my allowed list.");
        return;
      }

      try {
        const photos = msg.photo!;
        const fileId = photos[photos.length - 1]!.file_id;
        const fileLink = await this.bot.getFileLink(fileId);

        const res = await fetch(fileLink);
        if (!res.ok) throw new Error("Failed to download image");

        const arrayBuf = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        const channelMsg: ChannelMessage = {
          id: msg.message_id.toString(),
          senderId: msg.from.id.toString(),
          senderName: msg.from.first_name || "Unknown",
          text: msg.caption ?? "Describe and analyze this image",
          photoBuffer: buffer,
          mimeType: "image/jpeg",
          chatId: msg.chat.id.toString(),
        };

        await this.messageCallback(channelMsg);
      } catch (err: any) {
        await this.bot.sendMessage(msg.chat.id, `❌ Error processing photo: ${err.message}`);
      }
    });

    this.bot.on("message", async (msg) => {
      if (!this.bot || !this.messageCallback || msg.photo) return;
      if (!msg.from || !this.isAllowed(msg.from.id)) {
        await this.bot.sendMessage(msg.chat.id, "🐼 Sorry, you're not on my allowed list.");
        return;
      }

      if (!msg.text) return;

      const channelMsg: ChannelMessage = {
        id: msg.message_id.toString(),
        senderId: msg.from.id.toString(),
        senderName: msg.from.first_name || "Unknown",
        text: msg.text,
        chatId: msg.chat.id.toString(),
      };

      await this.messageCallback(channelMsg);
    });
  }

  public async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling();
      this.bot = null;
    }
  }

  public async sendMessage(chatId: string, text: string, options?: { parseMode?: "Markdown" | "HTML" }): Promise<void> {
    if (!this.bot) throw new Error("Bot not initialized");
    await this.bot.sendMessage(chatId, text, {
      parse_mode: options?.parseMode === "Markdown" ? "Markdown" : undefined,
    });
  }

  public onMessage(callback: (msg: ChannelMessage) => Promise<void>): void {
    this.messageCallback = callback;
  }

  private isAllowed(userId: number): boolean {
    return this.allowedUsers.length === 0 || this.allowedUsers.includes(userId);
  }
}
