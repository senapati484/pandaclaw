#!/usr/bin/env bun
import { Command } from "commander";
const program = new Command();

program
    .name("pandaclaw")
    .description("A CLI tool for managing your projects")
    .version("1.0.0");
  
program
    .command("wakeup")
    .description("Wake up the panda and start the day!")
    .action(async () => {
        const { runWakeup } = await import("./tui/wakeup.js");
        await runWakeup();
    });

await program.parseAsync((globalThis as any).process.argv);