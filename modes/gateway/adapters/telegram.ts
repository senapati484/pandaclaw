import TelegramBot from "node-telegram-bot-api";
import type { ChannelAdapter, ChannelMessage } from "../adapter.js";
import type { PandaConfig } from "../../../ai/ai.config.js";
import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";

export class TelegramAdapter implements ChannelAdapter {
  public name = "telegram";
  private bot: TelegramBot | null = null;
  private config: PandaConfig;
  private messageCallback: ((msg: ChannelMessage) => Promise<void>) | null = null;
  private allowedUsers: number[];
  private pairingCode: string | null = null;

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

    // Generate pairing code if allowedUsers is empty
    if (this.allowedUsers.length === 0) {
      const codePart1 = Math.floor(100 + Math.random() * 900);
      const codePart2 = Math.floor(100 + Math.random() * 900);
      this.pairingCode = `${codePart1}-${codePart2}`;

      // Print a beautiful rounded terminal pairing banner
      console.log(chalk.hex("#5b4d9e")("\n╭──────────────────────────────────────────────────────────╮"));
      console.log(chalk.hex("#5b4d9e")("│ ") + chalk.bold.hex("#e8dcf8")("🐼 Telegram Dynamic Device Pairing") + " ".repeat(21) + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("├──────────────────────────────────────────────────────────┤"));
      console.log(chalk.hex("#5b4d9e")("│ ") + chalk.yellow("🔑 Pairing Code: ") + chalk.bold.underline.hex("#e8dcf8")(this.pairingCode) + " ".repeat(24) + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("│ ") + " ".repeat(56) + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("│ ") + chalk.gray("To securely pair your Telegram account with this device:") + "  " + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("│ ") + chalk.gray("1. Open your custom Telegram Bot chat.") + "                 " + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("│ ") + chalk.gray("2. Send this command: ") + chalk.bold.cyan(`/pair ${this.pairingCode}`) + "                   " + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("╰──────────────────────────────────────────────────────────╯\n"));
    }

    this.bot.on("photo", async (msg) => {
      if (!this.bot || !this.messageCallback) return;
      if (!msg.from || !this.isAllowed(msg.from.id)) {
        await this.sendPairingRequest(msg.chat.id);
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
      if (!this.bot || msg.photo) return;
      if (!msg.from) return;

      const text = msg.text?.trim() || "";

      // Handle pairing command
      if (text.startsWith("/pair")) {
        const parts = text.split(/\s+/);
        const codeInput = parts[1];

        if (!this.pairingCode) {
          await this.bot.sendMessage(msg.chat.id, "🐼 This device is already paired and secure!");
          return;
        }

        if (codeInput === this.pairingCode) {
          this.allowedUsers.push(msg.from.id);
          this.saveAllowedUser(msg.from.id);
          this.pairingCode = null; // Pair complete, clear code

          console.log(chalk.green(`\n✓ Paired successfully with Telegram user @${msg.from.username || msg.from.first_name} (ID: ${msg.from.id}) 🐼\n`));
          await this.bot.sendMessage(
            msg.chat.id,
            `🎉 *Device paired successfully!*\n\nWelcome @${msg.from.username || msg.from.first_name}, you are now authorized to command PandaClaw.`,
            { parse_mode: "Markdown" }
          );
        } else {
          await this.bot.sendMessage(
            msg.chat.id,
            "❌ *Invalid pairing code.*\n\nPlease double check the pairing code shown in your local terminal."
          );
        }
        return;
      }

      if (!this.isAllowed(msg.from.id)) {
        await this.sendPairingRequest(msg.chat.id);
        return;
      }

      if (!msg.text || !this.messageCallback) return;

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

  private async sendPairingRequest(chatId: number): Promise<void> {
    if (!this.bot) return;
    await this.bot.sendMessage(
      chatId,
      "🐼 *Sorry, your device is not yet paired with this PandaClaw instance.*\n\n" +
        "Please look at your terminal console and send the pair command:\n" +
        "`/pair <pairing-code>`",
      { parse_mode: "Markdown" }
    );
  }

  private saveAllowedUser(userId: number): void {
    let configPath = path.join(process.cwd(), "config.json");
    if (!fs.existsSync(configPath)) {
      const globalPath = path.join(os.homedir(), ".pandaclaw", "config.json");
      if (fs.existsSync(globalPath)) {
        configPath = globalPath;
      }
    }

    if (fs.existsSync(configPath)) {
      try {
        const fileContent = fs.readFileSync(configPath, "utf8");
        const data = JSON.parse(fileContent);
        data.telegram = data.telegram || {};
        data.telegram.allowed_users = data.telegram.allowed_users || [];
        if (!data.telegram.allowed_users.includes(userId)) {
          data.telegram.allowed_users.push(userId);
          fs.writeFileSync(configPath, JSON.stringify(data, null, 2), "utf8");
        }
      } catch (err: any) {
        console.error(chalk.red(`Error writing paired user to config.json: ${err.message}`));
      }
    }
  }
}
