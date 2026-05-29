// tui/wakeup.ts

import { select, isCancel } from "@clack/prompts";
import chalk from "chalk";
import figlet from "figlet";
import { runCli } from "../modes/cli";

const BANNER_FONT = "ANSI Shadow";
const SHADOW = chalk.hex('#5b4d9e');
const FACE = chalk.hex('#e8dcf8');

function printBannerWithShadow (ascii: string) {
    const bannerLines = ascii.replace(/\s+$/, "").split("\n");
    const maxLen = Math.max(...bannerLines.map((line) => line.length), 0);
    const rowWidth = maxLen + 2;

    for (const line of bannerLines) {
        console.log(SHADOW(('  ' + line).padEnd(rowWidth, ' ')));
    }
    (globalThis as any).process.stdout.write(`\x1b[${bannerLines.length}A`); // Move cursor up to the start of the banner
    for (const line of bannerLines) {
        console.log(FACE(('  ' + line).padEnd(rowWidth, ' ')));
    }
    console.log();
} 

export async function runWakeup () {
    let aschii: string
    try {
        aschii = figlet.textSync("PANDACLAW", { font: BANNER_FONT });
    } catch (error) {
        aschii = figlet.textSync("PANDACLAW", { font: "standard" });
    }
    printBannerWithShadow(aschii);
    
    // console.log(FACE(aschii));
    console.log(SHADOW("🐼 The panda is awake! 🐼\n"));

    const mode = await select({
        message: "Which mode do you want to start with?",
        options: [
            { value: "cli", label: "Cli" },
            { value: "telegram", label: "Telegram" },
            { value: "exit", label: "Exit" },
        ],
    });

    if (isCancel(mode)) {
        console.log(SHADOW("Maybe later, panda..."));
        (globalThis as any).process.exit(0);
    }

    if (mode === "cli") {
        await runCli();
    } else if (mode === "telegram") {
        const { Gateway } = await import("../modes/gateway/index.js");
        const gateway = new Gateway();
        await gateway.start();
        await new Promise<never>(() => {});
    } else if (mode === "exit") {
        console.log(SHADOW("Goodbye, panda! 👋"));
        (globalThis as any).process.exit(0);
    } else {
        console.log(FACE(`\nLet's take a rest! 😴`));
    }
}