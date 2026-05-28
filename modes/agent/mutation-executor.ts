import { createFileSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { confirm, text } from "@clack/prompts";
import chalk from "chalk";
import type { MutationProposal, ExecutionResult, AgentConfig } from "./types";
import { estimateMutationRisk } from "./types";

export class MutationExecutor {
  private codebasePath: string;
  private config: AgentConfig;
  private executedCount: number = 0;

  constructor(codebasePath: string, config: AgentConfig) {
    this.codebasePath = codebasePath;
    this.config = config;
  }

  /**
   * Decide whether to execute a mutation directly or ask for approval
   */
  async shouldExecute(mutation: MutationProposal): Promise<boolean> {
    const risk = estimateMutationRisk(mutation, this.config);

    // Always ask for high-risk operations
    if (risk === "high") {
      return await this.askForApproval(mutation);
    }

    // For medium risk, check if we've already executed several mutations
    if (risk === "medium") {
      if (
        this.executedCount >= this.config.approvalThresholds.autoExecuteMutationLimit
      ) {
        return await this.askForApproval(mutation);
      }
      // Otherwise auto-execute
      return true;
    }

    // Low risk: auto-execute
    return true;
  }

  /**
   * Execute a mutation (file operation)
   */
  async execute(mutation: MutationProposal): Promise<ExecutionResult> {
    const startTime = new Date();

    try {
      const fullPath = join(this.codebasePath, mutation.path);

      switch (mutation.type) {
        case "file_create":
          await this.executeFileCreate(fullPath, mutation);
          break;
        case "file_modify":
          await this.executeFileModify(fullPath, mutation);
          break;
        case "file_delete":
          await this.executeFileDelete(fullPath);
          break;
        case "folder_create":
          await this.executeFolderCreate(fullPath);
          break;
        case "folder_delete":
          await this.executeFolderDelete(fullPath);
          break;
        case "shell_command":
          await this.executeShellCommand(mutation.command!);
          break;
      }

      this.executedCount++;

      return {
        success: true,
        mutationId: mutation.id,
        output: `Successfully executed ${mutation.type} on ${mutation.path}`,
        executedAt: startTime,
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);

      return {
        success: false,
        mutationId: mutation.id,
        error: errorMsg,
        executedAt: startTime,
      };
    }
  }

  /**
   * Reset execution counter
   */
  reset(): void {
    this.executedCount = 0;
  }

  // ============ Private Helpers ============

  private async askForApproval(mutation: MutationProposal): Promise<boolean> {
    console.log(
      "\n" + chalk.yellow("━".repeat(60))
    );
    console.log(chalk.cyan(`\n🤔 Agent wants to ${mutation.type}`));
    console.log(chalk.gray(`Path: ${mutation.path}`));
    console.log(chalk.gray(`Risk: ${mutation.estimatedRisk}`));
    console.log(chalk.gray(`Reason: ${mutation.rationale}`));

    if (mutation.content) {
      const preview = mutation.content.substring(0, 200);
      console.log(chalk.gray(`Preview:\n${preview}${mutation.content.length > 200 ? "..." : ""}`));
    }

    console.log(chalk.yellow("\n━".repeat(60)) + "\n");

    const approved = await confirm({
      message: "Approve this mutation?",
      initialValue: mutation.estimatedRisk === "low",
    });

    return approved;
  }

  private async executeFileCreate(fullPath: string, mutation: MutationProposal): Promise<void> {
    // Create parent directories if needed
    const parentDir = dirname(fullPath);
    mkdirSync(parentDir, { recursive: true });

    // Create file with content
    if (mutation.content) {
      writeFileSync(fullPath, mutation.content, "utf-8");
    } else {
      createFileSync(fullPath);
    }
  }

  private async executeFileModify(
    fullPath: string,
    mutation: MutationProposal
  ): Promise<void> {
    if (!mutation.content) {
      throw new Error("File modify requires content");
    }

    writeFileSync(fullPath, mutation.content, "utf-8");
  }

  private async executeFileDelete(fullPath: string): Promise<void> {
    rmSync(fullPath, { force: true });
  }

  private async executeFolderCreate(fullPath: string): Promise<void> {
    mkdirSync(fullPath, { recursive: true });
  }

  private async executeFolderDelete(fullPath: string): Promise<void> {
    rmSync(fullPath, { recursive: true, force: true });
  }

  private async executeShellCommand(command: string): Promise<void> {
    if (!this.config.tools.allowShellExecution) {
      throw new Error("Shell execution is disabled in config");
    }

    // Use Bun's shell execution
    const { $, spawn } = await import("bun");
    try {
      const result = await $`${command}`;
      if (result.exitCode !== 0) {
        throw new Error(`Command failed with exit code ${result.exitCode}`);
      }
    } catch (error) {
      throw new Error(
        `Shell command failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
