#!/usr/bin/env bun

// index.ts

import { Command } from "commander";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const { version: pkgVersion } = _require("./package.json") as { version: string };

const program = new Command();

program
    .name("pandaclaw")
    .description("A deliberate, reasoning-first AI assistant — Ask, Plan, and Agent modes")
    .version(pkgVersion)
    .action(async () => {
        const { runWakeup } = await import("./tui/wakeup.js");
        await runWakeup();
    });


program
    .command("wakeup")
    .description("Launch the PandaClaw welcome menu")
    .alias("start")
    .action(async () => {
        const { runWakeup } = await import("./tui/wakeup.js");
        await runWakeup();
    });

program
    .command("ask")
    .description("Quick answers, file ops, and shell commands")
    .action(async () => {
        const { runAskMode } = await import("./modes/ask/orchestrator.js");
        await runAskMode();
    });

program
    .command("agent")
    .description("Autonomous swarm agent for complex multi-step goals")
    .action(async () => {
        const { runAgentMode } = await import("./modes/agent/orchestrator.js");
        await runAgentMode();
    });

program
    .command("plan")
    .description("Goal → plan → execute with per-step approval")
    .action(async () => {
        const { runPlanMode } = await import("./modes/plan/orchestrator.js");
        await runPlanMode();
    });

program
    .command("dashboard")
    .description("Start the Visual Canvas Web Dashboard (port 18789)")
    .alias("web")
    .action(async () => {
        const { server } = await import("./canvas/server.js");
        console.log("Dashboard running. Press Ctrl+C to stop.");
        await new Promise<never>(() => {});
    });

program
    .command("setup")
    .description("Configure API keys and provider settings interactively")
    .alias("config")
    .action(async () => {
        const { runSetup } = await import("./tui/setup.js");
        await runSetup();
    });

program
  .command("daemon")
  .description("Manage PandaClaw background daemon service")
  .argument("[action]", "Action: status (default), start, stop, restart, logs")
  .action(async (action?: string) => {
    const { startDaemon, stopDaemon, daemonStatus, tailDaemonLogs } = await import("./tui/daemon.js");
    const cmd = action || "status";

    switch (cmd) {
      case "start":
        try {
          startDaemon();
        } catch (e: any) {
          console.error(e.message);
        }
        break;
      case "stop":
        try {
          stopDaemon();
        } catch (e: any) {
          console.error(e.message);
        }
        break;
      case "restart":
        try {
          stopDaemon();
          startDaemon();
        } catch (e: any) {
          console.error(e.message);
        }
        break;
      case "status":
        daemonStatus();
        break;
      case "logs":
        tailDaemonLogs();
        break;
      default:
        console.log(`Unknown daemon action: ${cmd}. Use: start, stop, restart, status, logs`);
    }
  });

import { initDynamicSkills } from "./tools/index.js";
import { initProviders } from "./ai/llm.js";
import { readConfig } from "./ai/ai.config.js";

// Initialize dynamic skills from skills/ folder
await initDynamicSkills(process.cwd());

// Initialize AI providers for faster cold-start
try {
  const config = readConfig();
  initProviders(config);
} catch {
  // Config not available yet — will be initialized on first LLM call
}

// Session commands
import { getSessionManager } from "./modes/agent/session-manager.js";

program
  .command("sessions")
  .description("List, switch, or manage agent sessions")
  .argument("[action]", "Action: list (default), switch <id>, delete <id>, show")
  .argument("[value]", "Session ID for switch/delete")
  .action(async (action?: string, value?: string) => {
    const sm = getSessionManager();
    const cmd = action || "list";

    switch (cmd) {
      case "list": {
        const sessions = sm.listSessions();
        if (sessions.length === 0) {
          console.log("No sessions found. Start an agent session first.");
          return;
        }
        console.log("\n📋 Sessions:");
        for (const s of sessions) {
          const marker = s.status === "active" ? "●" : "○";
          const statusColor = s.status === "failed" ? "\x1b[31m" : s.status === "completed" ? "\x1b[32m" : "\x1b[36m";
          console.log(`  ${marker} ${statusColor}${s.id}\x1b[0m  "${s.name}" — ${s.goal.slice(0, 60)}`);
          console.log(`      status: ${s.status}, messages: ${s.messageCount}, updated: ${new Date(s.updatedAt).toLocaleString()}`);
        }
        break;
      }
      case "switch": {
        if (!value) { console.log("Usage: pandaclaw sessions switch <session-id>"); return; }
        const ok = sm.switchSession(value);
        console.log(ok ? `✓ Switched to session ${value}` : `✗ Session ${value} not found`);
        break;
      }
      case "delete": {
        if (!value) { console.log("Usage: pandaclaw sessions delete <session-id>"); return; }
        const ok = sm.deleteSession(value);
        console.log(ok ? `✓ Deleted session ${value}` : `✗ Session ${value} not found`);
        break;
      }
      case "show": {
        const active = sm.getActiveSession();
        if (!active) { console.log("No active session."); return; }
        console.log(`\n📌 Active Session: ${active.data.id}`);
        console.log(`  Name:    ${active.data.name}`);
        console.log(`  Goal:    ${active.data.goal}`);
        console.log(`  Status:  ${active.data.status}`);
        console.log(`  Workspace: ${active.data.workspacePath}`);
        console.log(`  Messages: ${active.data.messageCount}`);
        console.log(`  Iterations: ${active.data.iterationCount}`);
        console.log(`  Actions: ${active.actions.length}`);
        console.log(`  Created: ${new Date(active.data.createdAt).toLocaleString()}`);
        console.log(`  Updated: ${new Date(active.data.updatedAt).toLocaleString()}`);
        break;
      }
      default:
        console.log(`Unknown action: ${cmd}. Use: list, switch <id>, delete <id>, show`);
    }
  });

program
  .command("cost")
  .description("Show persistent API token consumption and USD costs analysis")
  .action(async () => {
    const { CostTracker } = await import("./utils/cost-tracker.js");
    const { default: chalk } = await import("chalk");

    const history = CostTracker.getCostHistory();
    if (history.length === 0) {
      console.log(chalk.yellow("\nNo cost history recorded yet. Cost tracking begins on your first LLM query."));
      return;
    }

    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    const modelBreakdown: Record<string, { count: number; input: number; output: number; cost: number }> = {};

    for (const event of history) {
      totalInput += event.inputTokens;
      totalOutput += event.outputTokens;
      totalCost += event.costUsd;

      const m = event.model;
      if (!modelBreakdown[m]) {
        modelBreakdown[m] = { count: 0, input: 0, output: 0, cost: 0 };
      }
      modelBreakdown[m].count++;
      modelBreakdown[m].input += event.inputTokens;
      modelBreakdown[m].output += event.outputTokens;
      modelBreakdown[m].cost += event.costUsd;
    }

    console.log(chalk.cyan("\n🐼 PandaClaw Cost Analysis & Statistics"));
    console.log(chalk.gray("========================================="));
    console.log(`  Lifetime Queries:   ${chalk.bold(history.length)}`);
    console.log(`  Total Input Tokens: ${chalk.bold(totalInput.toLocaleString())}`);
    console.log(`  Total Output Tokens:${chalk.bold(totalOutput.toLocaleString())}`);
    console.log(`  Total Tokens:       ${chalk.bold((totalInput + totalOutput).toLocaleString())}`);
    console.log(`  Lifetime Cost:      ${chalk.bold.green(`$${totalCost.toFixed(6)}`)}`);
    console.log(`  Avg Cost / Query:   ${chalk.bold.yellow(`$${(totalCost / history.length).toFixed(6)}`)}`);

    console.log(chalk.cyan("\n📊 Cost Breakdown by Model:"));
    for (const [model, stats] of Object.entries(modelBreakdown)) {
      console.log(`  ● ${chalk.bold(model)}`);
      console.log(`      Queries: ${stats.count}`);
      console.log(`      Tokens:  ${(stats.input + stats.output).toLocaleString()} (in: ${stats.input.toLocaleString()}, out: ${stats.output.toLocaleString()})`);
      console.log(`      Cost:    ${chalk.green(`$${stats.cost.toFixed(6)}`)}`);
    }
    console.log();
  });

program
  .command("schedule")
  .description("Manage PandaClaw heartbeat schedules")
  .argument("[action]", "Action: list (default), add, remove, run, pause, resume, history")
  .argument("[arg1]", "Cron expression for add, or ID for remove/run/pause/resume")
  .argument("[arg2]", "Prompt / task description for add")
  .option("-n, --name <name>", "Task name", "Scheduled Task")
  .option("-c, --channel <channel>", "Channel: telegram, webchat, cli", "cli")
  .option("-t, --chat-id <chatId>", "Telegram chat ID for notification")
  .action(async (action?: string, arg1?: string, arg2?: string, options?: { name: string; channel: string; chatId?: string }) => {
    const { HeartbeatEngine, getNextRunTime } = await import("./utils/heartbeat.js");
    const { default: chalk } = await import("chalk");
    const engine = new HeartbeatEngine();
    const cmd = action || "list";

    switch (cmd) {
      case "list": {
        const tasks = engine.getTasks();
        if (tasks.length === 0) {
          console.log("No scheduled tasks found.");
          return;
        }
        console.log("\n⏰ Scheduled Tasks:");
        for (const t of tasks) {
          const status = t.enabled ? chalk.green("enabled") : chalk.red("paused");
          const next = t.enabled ? getNextRunTime(t.cron).toLocaleString() : "N/A";
          console.log(`  ● ${chalk.bold(t.name)} (ID: ${t.id}) — [${status}]`);
          console.log(`      cron:    "${t.cron}"`);
          console.log(`      prompt:  "${t.prompt}"`);
          console.log(`      channel: ${t.channel}${t.chatId ? ` (chatId: ${t.chatId})` : ""}`);
          console.log(`      next:    ${next}`);
        }
        break;
      }
      case "add": {
        if (!arg1 || !arg2) {
          console.log(`Usage: pandaclaw schedule add "<cron>" "<prompt>" [--name <name>] [--channel <channel>] [--chat-id <chat-id>]`);
          return;
        }
        const cron = arg1;
        const prompt = arg2;
        const channel = (options?.channel || "cli") as any;

        const task = engine.add({
          name: options?.name || "Scheduled Task",
          cron,
          prompt,
          channel,
          chatId: options?.chatId,
        });

        console.log(chalk.green(`✓ Added task "${task.name}" with ID: ${task.id}`));
        break;
      }
      case "remove": {
        if (!arg1) {
          console.log("Usage: pandaclaw schedule remove <id>");
          return;
        }
        const ok = engine.remove(arg1);
        console.log(ok ? `✓ Removed task ${arg1}` : `✗ Task ${arg1} not found`);
        break;
      }
      case "pause": {
        if (!arg1) {
          console.log("Usage: pandaclaw schedule pause <id>");
          return;
        }
        const ok = engine.pause(arg1, false);
        console.log(ok ? `✓ Paused task ${arg1}` : `✗ Task ${arg1} not found`);
        break;
      }
      case "resume": {
        if (!arg1) {
          console.log("Usage: pandaclaw schedule resume <id>");
          return;
        }
        const ok = engine.pause(arg1, true);
        console.log(ok ? `✓ Resumed task ${arg1}` : `✗ Task ${arg1} not found`);
        break;
      }
      case "run": {
        if (!arg1) {
          console.log("Usage: pandaclaw schedule run <id>");
          return;
        }
        const task = engine.getTasks().find(t => t.id === arg1);
        if (!task) {
          console.log(`✗ Task ${arg1} not found`);
          return;
        }
        console.log(`Running task "${task.name}" immediately...`);
        await engine.runTask(task);
        break;
      }
      case "history": {
        const history = engine.getScheduleHistory();
        if (history.length === 0) {
          console.log("No scheduled task execution history found.");
          return;
        }
        console.log("\n⏰ Scheduled Task Run History (Last 20):");
        console.log(chalk.gray("=================================================================================="));
        const lastRuns = history.slice(-20).reverse();
        for (const run of lastRuns) {
          const time = new Date(run.timestamp).toLocaleString();
          const statusText = run.status === "success" 
            ? chalk.green("SUCCESS") 
            : chalk.bold.red("FAILED");
          console.log(`  ● [${time}] ${chalk.bold(run.taskName)} (ID: ${run.taskId}) → ${statusText}`);
          console.log(`      prompt: "${run.prompt}"`);
          if (run.status === "success" && run.response) {
            console.log(`      result: ${chalk.gray(run.response.slice(0, 150))}`);
          }
          if (run.status === "failed" && run.error) {
            console.log(`      error:  ${chalk.red(run.error)}`);
          }
          console.log();
        }
        break;
      }
      default:
        console.log(`Unknown schedule action: ${cmd}. Use: list, add, remove, run, pause, resume, history`);
    }
  });

program
  .command("workspace")
  .description("Manage PandaClaw named workspaces")
  .argument("[action]", "Action: show (default), list, create <name>, switch <name>, delete <name>")
  .argument("[value]", "Workspace name for create/switch/delete")
  .option("-d, --dir <directory>", "Working directory path for create", ".")
  .action(async (action?: string, value?: string, options?: { dir: string }) => {
    const { WorkspaceManager } = await import("./modes/agent/workspace-manager.js");
    const { default: chalk } = await import("chalk");
    const wm = new WorkspaceManager();
    const cmd = action || "show";

    switch (cmd) {
      case "show": {
        const activeName = wm.getActiveName();
        const active = wm.getActive();
        console.log(`\n📌 Active Workspace: ${chalk.bold(activeName)}`);
        if (active) {
          console.log(`  Path:       ${active.path}`);
          console.log(`  Memory Dir: ${active.memoryDir}`);
          console.log(`  Created:    ${new Date(active.createdAt).toLocaleString()}`);
        } else {
          console.log(`  Context:    Local project directory (.pandaclaw)`);
        }
        break;
      }
      case "list": {
        const list = wm.list();
        const activeName = wm.getActiveName();
        console.log("\n📁 Workspaces:");
        const markerDefault = activeName === "default" ? "●" : "○";
        console.log(`  ${markerDefault} ${chalk.bold("default")}  —  Local directory context`);
        for (const w of list) {
          const marker = w.name === activeName ? "●" : "○";
          console.log(`  ${marker} ${chalk.bold(w.name)}  —  path: ${w.path}`);
        }
        break;
      }
      case "create": {
        if (!value) {
          console.log("Usage: pandaclaw workspace create <name> [--dir <path>]");
          return;
        }
        try {
          const ws = wm.create(value, options?.dir || ".");
          console.log(chalk.green(`✓ Created workspace "${ws.name}" mapped to ${ws.path}`));
          wm.switchWorkspace(ws.name);
        } catch (err: any) {
          console.error(chalk.red(err.message));
        }
        break;
      }
      case "switch": {
        if (!value) {
          console.log("Usage: pandaclaw workspace switch <name>");
          return;
        }
        try {
          wm.switchWorkspace(value);
        } catch (err: any) {
          console.error(chalk.red(err.message));
        }
        break;
      }
      case "delete": {
        if (!value) {
          console.log("Usage: pandaclaw workspace delete <name>");
          return;
        }
        try {
          wm.deleteWorkspace(value);
          console.log(chalk.green(`✓ Deleted workspace "${value}"`));
        } catch (err: any) {
          console.error(chalk.red(err.message));
        }
        break;
      }
      default:
        console.log(`Unknown workspace action: ${cmd}. Use: show, list, create <name>, switch <name>, delete <name>`);
    }
  });

program
  .command("skills")
  .description("Manage PandaClaw custom skills")
  .argument("[action]", "Action: installed (default), list, install <id-or-url>, remove <id>, publish")
  .argument("[value]", "Skill ID or URL for install/remove")
  .action(async (action?: string, value?: string) => {
    const { fetchRegistry, installSkill, removeSkill, listInstalled } = await import("./tools/skills-manager.js");
    const { default: chalk } = await import("chalk");
    const { default: path } = await import("path");
    const cmd = action || "installed";

    switch (cmd) {
      case "installed": {
        const list = listInstalled();
        if (list.length === 0) {
          console.log("No custom skills installed yet. Browse community skills with: pandaclaw skills list");
          return;
        }
        console.log("\n🛠 Installed Skills:");
        for (const file of list) {
          console.log(`  ● ${chalk.bold(path.basename(file, path.extname(file)))} (${file})`);
        }
        break;
      }
      case "list": {
        console.log(chalk.gray("Fetching community registry..."));
        try {
          const registry = await fetchRegistry();
          console.log("\n🌍 Community Skills Registry:");
          for (const s of registry) {
            console.log(`  ● ${chalk.bold(s.name)} (ID: ${chalk.cyan(s.id)}) — v${s.version} by @${s.author}`);
            console.log(`      desc:    "${s.description}"`);
            console.log(`      tags:    ${s.tags.join(", ")}`);
            console.log(`      installs: ${s.installs}`);
          }
        } catch (err: any) {
          console.error(chalk.red(`Failed to fetch registry: ${err.message}`));
        }
        break;
      }
      case "install": {
        if (!value) {
          console.log("Usage: pandaclaw skills install <id-or-url>");
          return;
        }
        console.log(chalk.gray(`Installing skill "${value}"...`));
        try {
          const filename = await installSkill(value);
          console.log(chalk.green(`✓ Successfully installed skill to ~/.pandaclaw/skills/${filename}`));
        } catch (err: any) {
          console.error(chalk.red(`Installation failed: ${err.message}`));
        }
        break;
      }
      case "remove": {
        if (!value) {
          console.log("Usage: pandaclaw skills remove <id>");
          return;
        }
        const ok = removeSkill(value);
        console.log(ok ? chalk.green(`✓ Removed skill ${value}`) : chalk.red(`✗ Skill ${value} not found`));
        break;
      }
      case "publish": {
        console.log(chalk.yellow("Publishing is coming soon! Push your skill to a GitHub Gist and share it in our Discord/repo."));
        break;
      }
      default:
        console.log(`Unknown skills action: ${cmd}. Use: installed, list, install <id-or-url>, remove <id>, publish`);
    }
  });

program
  .command("webhook")
  .description("Manage PandaClaw webhook event integrations")
  .argument("[action]", "Action: list (default), add <source>, remove <source>")
  .argument("[value]", "Source name (e.g. github, zapier)")
  .option("-s, --secret <secret>", "Webhook verification secret / token")
  .option("-c, --channel <channel>", "Notification channel: telegram, slack, cli", "telegram")
  .option("-t, --chat-id <chatId>", "Telegram chat ID / Slack webhook URL for output")
  .action(async (action?: string, value?: string, options?: { secret?: string; channel: string; chatId?: string }) => {
    const { readConfig } = await import("./ai/ai.config.js");
    const { default: chalk } = await import("chalk");
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");

    const configPath = path.join(process.cwd(), "config.json");
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red("config.json not found in current directory."));
      return;
    }

    const config = readConfig();
    const webhooks = config.webhooks || [];
    const cmd = action || "list";

    switch (cmd) {
      case "list": {
        if (webhooks.length === 0) {
          console.log("No webhooks configured. Add one with: pandaclaw webhook add <source>");
          return;
        }
        console.log("\n🛜 Configured Webhooks:");
        for (const h of webhooks) {
          console.log(`  ● ${chalk.bold(h.source)}  →  channel: ${h.channel}${h.chatId ? ` (dest: ${h.chatId})` : ""}`);
          console.log(`      url path: http://localhost:18789/webhook/${h.source}`);
        }
        break;
      }
      case "add": {
        if (!value) {
          console.log("Usage: pandaclaw webhook add <source> [--secret <secret>] [--channel <channel>] [--chat-id <chatId>]");
          return;
        }
        const source = value.toLowerCase().trim();
        if (webhooks.some(h => h.source === source)) {
          console.log(chalk.red(`Webhook for source "${source}" already exists.`));
          return;
        }

        const newHook = {
          source,
          secret: options?.secret || "",
          channel: (options?.channel || "telegram") as any,
          chatId: options?.chatId,
        };

        webhooks.push(newHook);
        config.webhooks = webhooks;

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
        console.log(chalk.green(`✓ Added webhook for "${source}"`));
        console.log(`  Endpoint URL: http://localhost:18789/webhook/${source}`);
        break;
      }
      case "remove": {
        if (!value) {
          console.log("Usage: pandaclaw webhook remove <source>");
          return;
        }
        const source = value.toLowerCase().trim();
        const filtered = webhooks.filter(h => h.source !== source);
        if (filtered.length === webhooks.length) {
          console.log(chalk.red(`Webhook for source "${source}" not found.`));
          return;
        }

        config.webhooks = filtered;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
        console.log(chalk.green(`✓ Removed webhook for "${source}"`));
        break;
      }
      default:
        console.log(`Unknown webhook action: ${cmd}. Use: list, add <source>, remove <source>`);
    }
  });

await program.parseAsync((globalThis as any).process.argv);