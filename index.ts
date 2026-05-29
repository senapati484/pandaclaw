#!/usr/bin/env bun

// index.ts

import { Command } from "commander";
const program = new Command();

program
    .name("pandaclaw")
    .description("A CLI tool for managing your projects")
    .version("1.0.0")
    .action(async () => {
        const { runWakeup } = await import("./tui/wakeup.js");
        await runWakeup();
    });
  
program
    .command("wakeup")
    .description("Wake up the panda and start the day!")
    .action(async () => {
        const { runWakeup } = await import("./tui/wakeup.js");
        await runWakeup();
    });

program
    .command("setup")
    .description("Configure PandaClaw settings interactively")
    .action(async () => {
        const { runSetup } = await import("./tui/setup.js");
        await runSetup();
    });

await program.parseAsync((globalThis as any).process.argv);