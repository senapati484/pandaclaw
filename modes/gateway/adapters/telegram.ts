import TelegramBot from "node-telegram-bot-api";
import type { ChannelAdapter, ChannelMessage } from "../adapter.js";
import type { PandaConfig } from "../../../ai/ai.config.js";
import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";

// ── Paired users storage ──────────────────────────────────────────────────
// Paired user IDs are stored in .pandaclaw/paired-users.json which is gitignored.
// This means each device running PandaClaw has its own local authorized users list.
// The shared bot token lives in config.json, but authorization is per-device.

function getPairedUsersPath(): string {
  const localPath = path.join(process.cwd(), ".pandaclaw", "paired-users.json");
  if (fs.existsSync(path.dirname(localPath))) return localPath;
  // Fallback: global ~/.pandaclaw/paired-users.json
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

  // Ensure the .pandaclaw directory exists
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

// ── Adapter ───────────────────────────────────────────────────────────────

export class TelegramAdapter implements ChannelAdapter {
  public name = "telegram";
  private bot: TelegramBot | null = null;
  private config: PandaConfig;
  private messageCallback: ((msg: ChannelMessage) => Promise<void>) | null = null;
  private allowedUsers: number[];
  private pairingCode: string | null = null;

  constructor(config: PandaConfig) {
    this.config = config;

    // Merge: config.json allowed_users + locally paired users from .pandaclaw/paired-users.json
    const fromConfig = config.telegram?.allowed_users ?? [];
    const fromStorage = loadPairedUsers();
    // Deduplicate
    this.allowedUsers = [...new Set([...fromConfig, ...fromStorage])];
  }

  public async initialize(): Promise<void> {
    const token = this.config.telegram?.token ?? process.env.TELEGRAM_TOKEN ?? "";
    if (!token) {
      throw new Error("Missing Telegram token");
    }

    // dropPendingUpdates: true — skip messages queued while bot was offline.
    // This prevents replaying stale messages after a restart/crash.
    this.bot = new TelegramBot(token, {
      polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10, allowed_updates: ["message"] },
      },
    });

    // ── Drop pending updates on startup to avoid replaying stale messages ──
    try {
      await (this.bot as any).getUpdates({ offset: -1, limit: 1 });
    } catch { /* best-effort */ }

    // ── Handle polling errors gracefully (especially 409 Conflict) ──────────
    this.bot.on("polling_error", (err: any) => {
      const code: string = err?.code ?? "";
      const msg: string = err?.message ?? String(err);

      if (code === "ETELEGRAM" && msg.includes("409")) {
        // Another instance is running — stop this one cleanly
        console.warn(chalk.yellow(
          "\n⚠️  Another PandaClaw instance is already running (Telegram 409).\n" +
          "   Stop the other instance first, then restart.\n"
        ));
        this.bot?.stopPolling().catch(() => {});
        return;
      }

      // Log other non-fatal polling errors without crashing
      if (!msg.includes("EFATAL") && !msg.includes("terminated")) {
        console.warn(chalk.gray(`  [telegram] polling warning: ${msg.slice(0, 120)}`));
      }
    });

    // ── Clean shutdown on Ctrl+C / SIGTERM ──────────────────────────────────
    const cleanup = () => {
      this.bot?.stopPolling().catch(() => {});
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);

    // Generate pairing code if no users are authorized yet on this device
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
      console.log(chalk.hex("#5b4d9e")("│ ") + chalk.gray("To authorize your Telegram account on this device:") + "      " + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("│ ") + chalk.gray("1. Open the bot chat in Telegram.") + "                       " + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("│ ") + chalk.gray("2. Send: ") + chalk.bold.cyan(`/pair ${this.pairingCode}`) + "                              " + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("│ ") + " ".repeat(56) + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("│ ") + chalk.gray("Each person runs their own PandaClaw + pairs their own") + "  " + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("│ ") + chalk.gray("Telegram account. One bot, many devices. ✅") + "             " + chalk.hex("#5b4d9e")(" │"));
      console.log(chalk.hex("#5b4d9e")("╰──────────────────────────────────────────────────────────╯\n"));
    } else {
      console.log(chalk.hex("#5b4d9e")(`\n  🐼 Telegram bot ready — ${this.allowedUsers.length} device(s) authorized.\n`));
    }

    // ── Photo handler ───────────────────────────────────────────────────────
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

    // ── Audio/voice handler ─────────────────────────────────────────────────
    const handleAudio = async (
      msg: any,
      fileId: string,
      mimeType: string,
      defaultFileName: string
    ) => {
      if (!this.bot || !this.messageCallback) return;
      if (!msg.from || !this.isAllowed(msg.from.id)) {
        await this.sendPairingRequest(msg.chat.id);
        return;
      }

      try {
        await this.bot.sendChatAction(msg.chat.id, "typing");

        const fileLink = await this.bot.getFileLink(fileId);
        const res = await fetch(fileLink);
        if (!res.ok) throw new Error("Failed to download audio file");

        const arrayBuf = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        const groqApiKey = this.config.providers.groq.api_key;
        if (!groqApiKey) {
          throw new Error("Groq API key is required to process voice messages.");
        }

        const { transcribeAudio } = await import("../../../ai/llm.js");
        const text = await transcribeAudio(buffer, mimeType, defaultFileName, groqApiKey);

        if (!text) {
          await this.bot.sendMessage(msg.chat.id, "🐼 I couldn't hear or transcribe any speech in that audio.");
          return;
        }

        await this.bot.sendMessage(msg.chat.id, `🎙 *Transcribed:* _"${text}"_`, { parse_mode: "Markdown" });

        const channelMsg: ChannelMessage = {
          id: msg.message_id.toString(),
          senderId: msg.from.id.toString(),
          senderName: msg.from.first_name || "Unknown",
          text: text,
          chatId: msg.chat.id.toString(),
        };

        await this.messageCallback(channelMsg);
      } catch (err: any) {
        await this.bot.sendMessage(msg.chat.id, `❌ Error processing voice message: ${err.message}`);
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

    // ── Text handler ────────────────────────────────────────────────────────
    this.bot.on("message", async (msg) => {
      if (!this.bot || msg.photo || msg.voice || msg.audio) return;
      if (!msg.from) return;

      const text = msg.text?.trim() || "";

      // /pair command — pair this Telegram account with this device
      if (text.startsWith("/pair")) {
        const parts = text.split(/\s+/);
        const codeInput = parts[1];

        if (!this.pairingCode) {
          await this.bot.sendMessage(msg.chat.id, "🐼 This device already has authorized users. No pairing needed!");
          return;
        }

        if (codeInput === this.pairingCode) {
          this.allowedUsers.push(msg.from.id);
          savePairedUser(msg.from.id);  // Save to .pandaclaw/paired-users.json (gitignored)
          this.pairingCode = null; // Clear code after successful pairing

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
        return;
      }

      // Not authorized yet
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
    const codeHint = this.pairingCode
      ? `\n\nSend \`/pair <code>\` with the code shown in your terminal.`
      : `\n\nThis device already has authorized users. You need access to the machine running PandaClaw.`;

    await this.bot.sendMessage(
      chatId,
      "🐼 *Your Telegram account is not yet paired with this device.*" + codeHint,
      { parse_mode: "Markdown" }
    );
  }
}
