// modes/telegram/bot.ts
// Telegram polling bot — text messages route to ask mode, photos route to vision pipeline

import TelegramBot from "node-telegram-bot-api";
import chalk from "chalk";
import type { AskTask } from "../../modes/agent/types.js";
import { classifyTask } from "../ask/classifier.js";
import { runFastPath } from "../ask/fast-path.js";
import { runPandaMode } from "../ask/panda-mode.js";
import { runVisionPipeline } from "../../vision/index.js";
import { readConfig } from "../../ai/ai.config.js";
import { saveToMemory } from "../../memory/store.js";

const PANDA = chalk.hex("#5b4d9e");

function formatVisionReply(result: Awaited<ReturnType<typeof runVisionPipeline>>): string {
  const action = result.action;
  let reply = `🐼 *Vision Analysis*\n_Type: ${result.contentType}_\n\n`;

  switch (action.type) {
    case "describe":
      reply += action.summary;
      break;
    case "diagnose":
      reply += `**Issue:** ${action.issue}\n\n**Fix:** ${action.fix}`;
      break;
    case "navigate":
      reply += action.instruction;
      break;
    case "code_review":
      reply += action.findings.map((f) => `• ${f.message}`).join("\n");
      break;
    case "extract":
      reply += "```json\n" + JSON.stringify(action.data, null, 2) + "\n```";
      break;
    default:
      reply += JSON.stringify(action);
  }

  return reply;
}

export async function runTelegramMode(): Promise<void> {
  let config;
  try {
    config = readConfig();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\n  ❌ Config error: ${msg}\n`));
    return;
  }

  const token = config.telegram?.token ?? process.env.TELEGRAM_TOKEN ?? "";

  if (!token) {
    console.log(chalk.red("\n  ❌ No Telegram token found.\n"));
    console.log(chalk.gray("  Add your BotFather token to config.json → telegram.token\n"));
    console.log(chalk.gray("  Or set env var: TELEGRAM_TOKEN=...\n"));
    return;
  }

  const allowedUsers: number[] = config.telegram?.allowed_users ?? [];

  const bot = new TelegramBot(token, { polling: true });

  console.log(PANDA("\n🐼 Telegram bot started! The panda is listening...\n"));
  console.log(chalk.gray("  Press Ctrl+C to stop.\n"));

  const isAllowed = (userId: number): boolean =>
    allowedUsers.length === 0 || allowedUsers.includes(userId);

  // ── Photo messages → vision pipeline ──
  bot.on("photo", async (msg) => {
    if (!msg.from || !isAllowed(msg.from.id)) {
      await bot.sendMessage(msg.chat.id, "🐼 Sorry, you're not on my allowed list.");
      return;
    }

    const chatId = msg.chat.id;

    try {
      await bot.sendChatAction(chatId, "typing");

      const photos = msg.photo!;
      const fileId = photos[photos.length - 1]!.file_id;
      const fileLink = await bot.getFileLink(fileId);

      const res = await fetch(fileLink);
      if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const context = msg.caption ?? "Describe and analyze this image";

      const result = await runVisionPipeline(buffer, "image/jpeg", context);
      const reply = formatVisionReply(result);

      await bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
    } catch (err: unknown) {
      const msg2 = err instanceof Error ? err.message : String(err);
      await bot.sendMessage(chatId, `❌ Vision error: ${msg2}`);
    }
  });

  // ── Text messages → ask mode ──
  bot.on("message", async (msg) => {
    if (!msg.text) return; // handled by photo handler
    if (!msg.from || !isAllowed(msg.from.id)) {
      await bot.sendMessage(msg.chat.id, "🐼 Sorry, you're not on my allowed list.");
      return;
    }

    const chatId = msg.chat.id;
    const userText = msg.text;

    // /start command
    if (userText === "/start") {
      await bot.sendMessage(
        chatId,
        `🐼 *PandaClaw is awake!*\n\nI'm a thoughtful AI agent.\n\n` +
          `• Simple questions → instant answer\n` +
          `• Hard questions → I think step by step\n` +
          `• Send an image → I analyze it\n\n` +
          `Just type your question!`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // /help
    if (userText === "/help") {
      await bot.sendMessage(
        chatId,
        `🐼 *PandaClaw Help*\n\n` +
          `• Ask any question — I'll answer it\n` +
          `• Complex questions get panda mode (deep reasoning)\n` +
          `• Send a photo — I'll analyze it with vision AI\n` +
          `• /start — restart\n` +
          `• /help — this message`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await bot.sendChatAction(chatId, "typing");

    const taskType = classifyTask(userText);
    const task: AskTask = {
      id: crypto.randomUUID(),
      type: taskType,
      input: userText,
      conversationHistory: [], // TODO: per-chat history from memory
      createdAt: new Date(),
    };

    let thinkingMsgId: number | undefined;

    if (taskType === "complex") {
      const thinkingMsg = await bot.sendMessage(chatId, "🐼 *thinking...*", {
        parse_mode: "Markdown",
      });
      thinkingMsgId = thinkingMsg.message_id;
    }

    try {
      const result =
        taskType === "complex"
          ? await runPandaMode(task, config)
          : await runFastPath(task, config);

      // Delete thinking indicator
      if (thinkingMsgId) {
        await bot.deleteMessage(chatId, thinkingMsgId).catch(() => {});
      }

      const footer =
        taskType === "complex"
          ? `\n\n_🐼 panda mode · ${result.durationMs}ms${result.verified ? " · verified ✓" : ""}_`
          : `\n\n_⚡ fast · ${result.durationMs}ms_`;

      await bot.sendMessage(chatId, result.answer + footer, { parse_mode: "Markdown" });

      // Persist to memory
      try {
        saveToMemory({
          id: task.id,
          timestamp: Date.now(),
          role: "user",
          content: userText,
          importance: taskType === "complex" ? "high" : "low",
        });
      } catch {
        // Non-fatal
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (thinkingMsgId) {
        await bot.deleteMessage(chatId, thinkingMsgId).catch(() => {});
      }
      let friendly = `❌ Error: ${errMsg}`;
      if (errMsg.includes("429") || errMsg.toLowerCase().includes("rate limit")) {
        friendly = "⏳ *Rate limit hit* — AI providers are temporarily busy. Please wait a moment and try again!";
      } else if (errMsg.includes("All LLM providers failed")) {
        friendly = "🌐 *All AI providers are unreachable.* Check your internet or API keys in config.json.";
      }
      await bot.sendMessage(chatId, friendly, { parse_mode: "Markdown" });
    }
  });

  bot.on("polling_error", (err) => {
    console.error(chalk.red("Telegram polling error:"), err.message);
  });

  // Keep alive
  await new Promise<never>(() => {});
}
