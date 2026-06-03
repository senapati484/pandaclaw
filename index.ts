#!/usr/bin/env bun

// index.ts

import { Command } from "commander";
const program = new Command();

program
    .name("pandaclaw")
    .description("A deliberate, reasoning-first AI assistant — Ask, Plan, and Agent modes")
    .version("1.0.1")
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

await program.parseAsync((globalThis as any).process.argv);