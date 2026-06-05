// utils/heartbeat.ts
// Cron-based Heartbeat Engine for running proactive agent tasks.

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { readConfig } from "../ai/ai.config.js";
import { classifyRoute } from "../modes/ask/classifier.js";

const HOME = os.homedir();
const PANDA_DIR = path.join(HOME, ".pandaclaw");
const SCHEDULES_FILE = path.join(PANDA_DIR, "schedules.json");

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;           // "0 8 * * *" = every day at 8am
  prompt: string;         // What to ask the AI
  channel: "telegram" | "webchat" | "cli";
  chatId?: string;        // Telegram chat ID
  enabled: boolean;
  lastRun?: number;
}

export function matchesCron(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const min = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1; // 1-12
  const dow = date.getDay(); // 0-6 (Sunday is 0)

  const matchField = (field: string, val: number, minVal: number, maxVal: number): boolean => {
    if (field === "*") return true;

    // Check step: e.g. */5
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2), 10);
      return val % step === 0;
    }

    // Check list: e.g. 1,2,3
    if (field.includes(",")) {
      const parts = field.split(",");
      return parts.some(p => matchField(p, val, minVal, maxVal));
    }

    // Check range: e.g. 1-5
    if (field.includes("-")) {
      const [start, end] = field.split("-").map(x => parseInt(x, 10));
      return start !== undefined && end !== undefined && val >= start && val <= end;
    }

    // Exact match
    return parseInt(field, 10) === val;
  };

  return (
    matchField(fields[0]!, min, 0, 59) &&
    matchField(fields[1]!, hour, 0, 23) &&
    matchField(fields[2]!, dom, 1, 31) &&
    matchField(fields[3]!, month, 1, 12) &&
    matchField(fields[4]!, dow, 0, 6)
  );
}

export function getNextRunTime(cron: string): Date {
  const now = new Date();
  const searchLimit = now.getTime() + 7 * 24 * 60 * 60 * 1000; // Search up to 7 days
  let check = new Date(now.getTime() + 60000); // Start from next minute
  check.setSeconds(0);
  check.setMilliseconds(0);

  while (check.getTime() < searchLimit) {
    if (matchesCron(cron, check)) {
      return check;
    }
    check = new Date(check.getTime() + 60000);
  }
  return new Date(0);
}

export class HeartbeatEngine {
  private tasks: ScheduledTask[] = [];
  private intervalTimer: Timer | null = null;
  private alignTimer: Timer | null = null;

  constructor() {
    this.load();
  }

  public load(): void {
    if (!existsSync(SCHEDULES_FILE)) {
      this.tasks = [];
      return;
    }
    try {
      const raw = readFileSync(SCHEDULES_FILE, "utf8");
      this.tasks = JSON.parse(raw);
    } catch {
      this.tasks = [];
    }
  }

  public save(): void {
    try {
      const dir = path.dirname(SCHEDULES_FILE);
      if (!existsSync(dir)) {
        require("fs").mkdirSync(dir, { recursive: true });
      }
      writeFileSync(SCHEDULES_FILE, JSON.stringify(this.tasks, null, 2), "utf8");
    } catch (err: any) {
      console.error(chalk.red(`Failed to persist scheduled tasks: ${err.message}`));
    }
  }

  public add(task: Omit<ScheduledTask, "id" | "enabled">): ScheduledTask {
    const newTask: ScheduledTask = {
      ...task,
      id: Math.random().toString(36).substring(2, 11),
      enabled: true,
    };
    this.tasks.push(newTask);
    this.save();
    return newTask;
  }

  public remove(id: string): boolean {
    const len = this.tasks.length;
    this.tasks = this.tasks.filter(t => t.id !== id);
    if (this.tasks.length < len) {
      this.save();
      return true;
    }
    return false;
  }

  public pause(id: string, enabled: boolean): boolean {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.enabled = enabled;
      this.save();
      return true;
    }
    return false;
  }

  public getTasks(): ScheduledTask[] {
    return this.tasks;
  }

  public start(): void {
    if (this.intervalTimer || this.alignTimer) return;

    // Align to the next minute boundary
    const msToNextMinute = 60000 - (Date.now() % 60000);
    this.alignTimer = setTimeout(() => {
      this.checkAndRun();
      this.intervalTimer = setInterval(() => {
        this.checkAndRun();
      }, 60000);
    }, msToNextMinute);
  }

  public stop(): void {
    if (this.alignTimer) {
      clearTimeout(this.alignTimer);
      this.alignTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private async checkAndRun(): Promise<void> {
    const now = new Date();
    for (const task of this.tasks) {
      if (!task.enabled) continue;
      if (matchesCron(task.cron, now)) {
        await this.runTask(task);
      }
    }
  }

  public async runTask(task: ScheduledTask): Promise<void> {
    const config = readConfig();
    const route = classifyRoute(task.prompt);

    const toolCtx = {
      userId: "heartbeat-scheduler",
      channel: (task.channel === "telegram" ? "telegram" : "cli") as any,
      workspacePath: process.cwd(),
      requestConsent: async () => true, // Heartbeat runs autonomously in background
    };

    console.log(chalk.hex("#5b4d9e")(`\n⏰ [Heartbeat] Running task: "${task.name}" (${route} route)`));

    let answer = "";
    try {
      if (route === "action") {
        const { runToolAgent } = await import("../modes/ask/tool-agent.js");
        const res = await runToolAgent(task.prompt, config, toolCtx);
        answer = res.answer;
      } else if (route === "complex") {
        const { runPandaMode } = await import("../modes/ask/panda-mode.js");
        const res = await runPandaMode({
          id: crypto.randomUUID(),
          type: "complex",
          input: task.prompt,
          conversationHistory: [],
          createdAt: new Date(),
        }, config);
        answer = res.answer;
      } else {
        const { runFastPath } = await import("../modes/ask/fast-path.js");
        const res = await runFastPath({
          id: crypto.randomUUID(),
          type: "simple",
          input: task.prompt,
          conversationHistory: [],
          createdAt: new Date(),
        }, config);
        answer = res.answer;
      }

      task.lastRun = Date.now();
      this.save();

      // Dispatch results to output channel
      await this.dispatchResult(task, answer);
    } catch (err: any) {
      console.error(chalk.red(`  ❌ Task "${task.name}" failed: ${err.message}`));
      await this.dispatchResult(task, `❌ Scheduled task "${task.name}" failed: ${err.message}`);
    }
  }

  private async dispatchResult(task: ScheduledTask, result: string): Promise<void> {
    if (task.channel === "telegram") {
      const config = readConfig();
      const token = config.telegram?.token ?? process.env.TELEGRAM_TOKEN;
      const chatId = task.chatId;

      if (!token || !chatId) {
        console.error(chalk.red(`  ⚠️ Cannot send Telegram notification for task "${task.name}": Missing bot token or chatId`));
        return;
      }

      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: `⏰ *PandaClaw Scheduled Task: ${task.name}*\n\n${result}`, parse_mode: "Markdown" }),
        });
        if (!res.ok) {
          const txt = await res.text();
          console.error(chalk.red(`  ⚠️ Telegram API error: ${txt}`));
        }
      } catch (e: any) {
        console.error(chalk.red(`  ⚠️ Telegram send failed: ${e.message}`));
      }
    } else {
      // Print to local daemon.log / console
      console.log(chalk.green(`\n⏰ [Heartbeat Output - ${task.name}]:`));
      console.log(result);
      console.log();
    }
  }
}
