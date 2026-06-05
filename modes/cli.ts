import chalk from "chalk";
import { select, isCancel } from "@clack/prompts";
import { purple as PANDA } from "../utils/brand.js";

export async function runCli () {
    console.log(PANDA("\n🐼 PandaClaw CLI — Select a mode below:\n"));

    while (true) {
        const mode = await select({
            message: "Choose a mode",
            options: [
                { value: "ask", label: "Ask Mode — quick answers + actions (best for most tasks)" },
                { value: "agent", label: "Agent Mode — autonomous swarm (complex multi-step goals)" },
                { value: "plan", label: "Plan Mode — goal → plan → execute with approval" },
                { value: "back", label: "⬅ Back to main menu" },
            ]
        });

        if (isCancel(mode) || mode === "back") {
            return;
        }

        if (mode === "ask") {
            const { runAskMode } = await import("./ask/orchestrator.js");
            await runAskMode();
        } else if (mode === "agent") {
            const { runAgentMode } = await import("./agent/orchestrator.js");
            await runAgentMode();
        } else if (mode === "plan") {
            const { runPlanMode } = await import("./plan/orchestrator.js");
            await runPlanMode();
        } else {
            console.log(chalk.red("Unknown mode. Please try again."));
        }
    }
}