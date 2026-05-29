// modes/cli.ts

import chalk from "chalk";
import { select, isCancel } from "@clack/prompts";

export async function runCli () {
    while (true) {
        const mode = await select({
            message: "Choose CLI sub-mode",
            options: [
                { value: "agent", label: "Agent Mode" },
                { value: "plan", label: "Plan Mode" },
                { value: "ask", label: "Ask Mode" },
                { value: "back", label: "⬅ back to main menu" },
            ]
        });

        if (isCancel(mode) || mode === "back") {
            console.log(chalk.yellow("Maybe later, panda..."));
            return;
        }

        if (mode === "agent") {
            const { runAgentMode } = await import("./agent/orchestrator.js");
            await runAgentMode();
        } else if (mode === "plan") {
            const { runPlanMode } = await import("./plan/orchestrator.js");
            await runPlanMode();
        } else if (mode === "ask") {
            const { runAskMode } = await import("./ask/orchestrator.js");
            await runAskMode();
        } else {
            console.log(chalk.red("Unknown mode. Please try again."));
        }
    }
}