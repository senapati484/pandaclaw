import TelegramBot from "node-telegram-bot-api";
import type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
  ChannelRecipient,
  ChannelHealth,
} from "../channel-adapter.js";
import type { PandaConfig } from "../../../ai/ai.config.js";
import fs from "fs";
import path from "path";
import * as os from "os";
import chalk from "chalk";
import { purple, lavender } from "../../../utils/brand.js";

function getPairedUsersPath(): string {
  const localPath = path.join(process.cwd(), ".pandaclaw", "paired-users.json");
  if (fs.existsSync(path.dirname(localPath))) return localPath;
  return path.join(os.homedir(), ".pandaclaw", "paired-users.json");
}

function loadPairedUsers(): number[] {
  const filePath = getPairedUsersPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.users) ? data.users : [];
  } catch {
    return [];
  }
}

function savePairedUser(userId: number): void {
  const filePath = getPairedUsersPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let existing: number[] = [];
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw);
      existing = Array.isArray(data.users) ? data.users : [];
    } catch {}
  }

  if (!existing.includes(userId)) {
    existing.push(userId);
    fs.writeFileSync(filePath, JSON.stringify({ users: existing }), "utf8");
  }
}

export class TelegramAdapter implements ChannelAdapter {
  public readonly name = "TelegramAdapter";
  public readonly platform = "telegram" as const;

  private bot: TelegramBot | null = null;
  private config: PandaConfig;
  private messageHandler: ((msg: InboundMessage) => Promise<OutboundMessage | null>) | null = null;
  private allowedUsers: number[];
  private pairingCode: string | null = null;
  private started = false;

  constructor(config: PandaConfig) {
    this.config = config;
    const fromConfig = config.telegram?.allowed_users ?? [];
    const fromStorage = loadPairedUsers();
    this.allowedUsers = [...new Set([...fromConfig, ...fromStorage])];
  }

  public async start(): Promise<void> {
    const token = this.config.telegram?.token ?? process.env.TELEGRAM_TOKEN ?? "";
    if (!token) {
      throw new Error("Missing Telegram token");
    }

    await this.setupPolling(token);

    if (this.allowedUsers.length === 0) {
      this.generatePairingCode();
    } else {
      console.log(purple(`\n  🐼 Telegram bot ready — ${this.allowedUsers.length} device(s) authorized.\n`));
    }

    this.setupPhotoHandler();
    this.setupAudioHandlers();
    this.setupTextHandler();
    this.started = true;
  }

  public async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling();
      this.bot = null;
    }
    this.started = false;
  }

  public async send(recipient: ChannelRecipient, message: OutboundMessage): Promise<void> {
    if (!this.bot) throw new Error("Bot not initialized");
    await this.bot.sendMessage(recipient.channelId, message.text, {
      parse_mode: message.parseMode === "Markdown" ? "Markdown" : undefined,
    });
  }

  public onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): void {
    this.messageHandler = handler;
  }

  public health(): ChannelHealth {
    return { ok: this.started && this.bot !== null };
  }

  private async setupPolling(token: string): Promise<void> {
    this.bot = new TelegramBot(token, {
      polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10, allowed_updates: ["message"] },
      },
    });

    try {
      await (this.bot as any).getUpdates({ offset: -1, limit: 1 });
    } catch { /* best-effort */ }

    this.bot.on("polling_error", (err: any) => {
      const code: string = err?.code ?? "";
      const msg: string = err?.message ?? String(err);

      if (code === "ETELEGRAM" && msg.includes("409")) {
        console.warn(chalk.yellow(
          "\n⚠️  Another PandaClaw instance is already running (Telegram 409).\n" +
          "   Stop the other instance first, then restart.\n"
        ));
        this.bot?.stopPolling().catch(() => {});
        return;
      }

      if (!msg.includes("EFATAL") && !msg.includes("terminated")) {
        console.warn(chalk.gray(`  [telegram] polling warning: ${msg.slice(0, 120)}`));
      }
    });

    const cleanup = () => {
      this.bot?.stopPolling().catch(() => {});
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }

  private generatePairingCode(): void {
    const codePart1 = Math.floor(100 + Math.random() * 900);
    const codePart2 = Math.floor(100 + Math.random() * 900);
    this.pairingCode = `${codePart1}-${codePart2}`;

    const bar = purple("│");
    console.log(purple("\n╭──────────────────────────────────────────────────────────╮"));
    console.log(bar + " " + chalk.bold(lavender("🐼 Telegram Dynamic Device Pairing")) + " ".repeat(21) + " " + bar);
    console.log(purple("├──────────────────────────────────────────────────────────┤"));
    console.log(bar + " " + chalk.yellow("🔑 Pairing Code: ") + chalk.bold.underline(lavender(this.pairingCode)) + " ".repeat(24) + " " + bar);
    console.log(bar + " " + " ".repeat(56) + " " + bar);
    console.log(bar + " " + chalk.gray("To authorize your Telegram account on this device:") + "      " + bar);
    console.log(bar + " " + chalk.gray("1. Open the bot chat in Telegram.") + "                       " + bar);
    console.log(bar + " " + chalk.gray("2. Send: ") + chalk.bold.cyan(`/pair ${this.pairingCode}`) + "                              " + bar);
    console.log(bar + " " + " ".repeat(56) + " " + bar);
    console.log(bar + " " + chalk.gray("Each person runs their own PandaClaw + pairs their own") + "  " + bar);
    console.log(bar + " " + chalk.gray("Telegram account. One bot, many devices. ✅") + "             " + bar);
    console.log(purple("╰──────────────────────────────────────────────────────────╯\n"));
  }

  private setupPhotoHandler(): void {
    if (!this.bot) return;
    this.bot.on("photo", async (msg) => {
      if (!await this.checkAuthorized(msg)) return;

      try {
        const photos = msg.photo!;
        const fileId = photos[photos.length - 1]!.file_id;
        const buffer = await this.downloadTelegramFile(fileId);

        const inbound: InboundMessage = {
          id: msg.message_id.toString(),
          senderId: msg.from!.id.toString(),
          senderName: msg.from!.first_name || "Unknown",
          text: msg.caption ?? "Describe and analyze this image",
          photoBuffer: buffer,
          mimeType: "image/jpeg",
          chatId: msg.chat.id.toString(),
        };

        await this.messageHandler!(inbound);
      } catch (err: any) {
        await this.bot!.sendMessage(msg.chat.id, `❌ Error processing photo: ${err.message}`);
      }
    });
  }

  private setupAudioHandlers(): void {
    if (!this.bot) return;
    const handleAudio = async (
      msg: any,
      fileId: string,
      mimeType: string,
      defaultFileName: string
    ) => {
      if (!await this.checkAuthorized(msg)) return;

      try {
        await this.bot!.sendChatAction(msg.chat.id, "typing");

        const buffer = await this.downloadTelegramFile(fileId);

        const groqApiKey = this.config.providers.groq.api_key;
        if (!groqApiKey) {
          throw new Error("Groq API key is required to process voice messages.");
        }

        const { transcribeAudio } = await import("../../../ai/llm.js");
        const text = await transcribeAudio(buffer, mimeType, defaultFileName, groqApiKey);

        if (!text) {
          await this.bot!.sendMessage(msg.chat.id, "🐼 I couldn't hear or transcribe any speech in that audio.");
          return;
        }

        await this.bot!.sendMessage(msg.chat.id, `🎙 *Transcribed:* _"${text}"_`, { parse_mode: "Markdown" });

        const inbound: InboundMessage = {
          id: msg.message_id.toString(),
          senderId: msg.from!.id.toString(),
          senderName: msg.from!.first_name || "Unknown",
          text: text,
          chatId: msg.chat.id.toString(),
        };

        await this.messageHandler!(inbound);
      } catch (err: any) {
        await this.bot!.sendMessage(msg.chat.id, `❌ Error processing voice message: ${err.message}`);
      }
    };

    this.bot.on("voice", async (msg) => {
      if (!msg.voice) return;
      await handleAudio(msg, msg.voice.file_id, msg.voice.mime_type || "audio/ogg", "voice.ogg");
    });

    this.bot.on("audio", async (msg) => {
      if (!msg.audio) return;
      await handleAudio(msg, msg.audio.file_id, msg.audio.mime_type || "audio/mpeg", "audio.mp3");
    });
  }

  private async handlePairCommand(msg: any, text: string): Promise<void> {
    if (!this.bot) return;
    const parts = text.split(/\s+/);
    const codeInput = parts[1];

    if (!this.pairingCode) {
      await this.bot.sendMessage(msg.chat.id, "🐼 This device already has authorized users. No pairing needed!");
      return;
    }

    if (codeInput === this.pairingCode) {
      this.allowedUsers.push(msg.from.id);
      savePairedUser(msg.from.id);
      this.pairingCode = null;

      console.log(chalk.green(`\n✓ Paired! Telegram @${msg.from.username || msg.from.first_name} (ID: ${msg.from.id}) authorized on this device. 🐼\n`));
      await this.bot.sendMessage(
        msg.chat.id,
        `🎉 *Device paired successfully!*\n\nWelcome @${msg.from.username || msg.from.first_name}!\nYou are now authorized to command PandaClaw on this machine.\n\n_Your authorization is saved locally on this device._`,
        { parse_mode: "Markdown" }
      );
    } else {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ *Invalid pairing code.*\n\nPlease double-check the code shown in your local terminal.",
        { parse_mode: "Markdown" }
      );
    }
  }

  private setupTextHandler(): void {
    if (!this.bot) return;
    this.bot.on("message", async (msg) => {
      if (!this.bot || msg.photo || msg.voice || msg.audio) return;
      if (!msg.from) return;

      const text = msg.text?.trim() || "";

      if (text.startsWith("/pair")) {
        await this.handlePairCommand(msg, text);
        return;
      }

      if (!this.isAllowed(msg.from.id)) {
        await this.sendPairingRequest(msg.chat.id);
        return;
      }

      if (!msg.text || !this.messageHandler) return;

      const inbound: InboundMessage = {
        id: msg.message_id.toString(),
        senderId: msg.from.id.toString(),
        senderName: msg.from.first_name || "Unknown",
        text: msg.text,
        chatId: msg.chat.id.toString(),
      };

      await this.messageHandler(inbound);
    });
  }

  private isAllowed(userId: number): boolean {
    return this.allowedUsers.length === 0 || this.allowedUsers.includes(userId);
  }

  private async sendPairingRequest(chatId: number): Promise<void> {
    if (!this.bot) return;
    const codeHint = this.pairingCode
      ? `\n\nSend \`/pair <code>\` with the code shown in your terminal.`
      : `\n\nThis device already has authorized users. You need access to the machine running PandaClaw.`;

    await this.bot.sendMessage(
      chatId,
      "🐼 *Your Telegram account is not yet paired with this device.*" + codeHint,
      { parse_mode: "Markdown" }
    );
  }

  private async checkAuthorized(msg: any): Promise<boolean> {
    if (!this.bot || !this.messageHandler) return false;
    if (!msg.from || !this.isAllowed(msg.from.id)) {
      await this.sendPairingRequest(msg.chat.id);
      return false;
    }
    return true;
  }

  private async downloadTelegramFile(fileId: string): Promise<Buffer> {
    if (!this.bot) throw new Error("Bot is not initialized");
    const fileLink = await this.bot.getFileLink(fileId);
    const res = await fetch(fileLink);
    if (!res.ok) throw new Error(`Failed to download file from Telegram: ${res.statusText}`);
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }
}
