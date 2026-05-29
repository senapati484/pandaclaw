import chalk from "chalk";
import { select, isCancel, text, confirm } from "@clack/prompts";
import { randomUUID } from "crypto";
import type { ReactorSession, AgentConfig, ModelTaskType } from "./types";
import { defaultAgentConfig } from "./types";
import { ActionTracker } from "./action-tracker";
import { SessionMemoryManager } from "./session-memory";
import { CodebaseContextManager } from "./context-manager";
import { ModelSelector } from "./model-selector";
import { MutationExecutor } from "./mutation-executor";
import { ReflectionEngine } from "./reflection-engine";
import { ActionPlanner } from "./action-planner";

export class AgentOrchestrator {
  private session: ReactorSession | null = null;
  private tracker: ActionTracker | null = null;
  private memory: SessionMemoryManager | null = null;
  private contextManager: CodebaseContextManager | null = null;
  private modelSelector: ModelSelector;
  private executor: MutationExecutor | null = null;
  private reflectionEngine: ReflectionEngine | null = null;
  private planner: ActionPlanner;

  constructor() {
    this.modelSelector = new ModelSelector();
    this.planner = new ActionPlanner();
  }

  /**
   * Initialize a new agent session
   */
  async initializeSession(goal: string, config?: AgentConfig): Promise<ReactorSession> {
    console.log(chalk.cyan("\n🐼 Initializing Agent Session...\n"));

    const finalConfig = config || defaultAgentConfig();
    const sessionId = randomUUID();

    // Initialize components
    this.tracker = new ActionTracker();
    this.memory = new SessionMemoryManager(sessionId);
    this.contextManager = new CodebaseContextManager(
      finalConfig.codebasePath,
      finalConfig.maxFileSizeToRead
    );
    this.executor = new MutationExecutor(finalConfig.codebasePath, finalConfig);
    this.reflectionEngine = new ReflectionEngine(finalConfig.codebasePath);

    // Index codebase
    console.log(chalk.gray("Indexing codebase..."));
    await this.contextManager.indexCodebase();

    // Create session
    this.session = {
      id: sessionId,
      goal,
      createdAt: new Date(),
      modelConfigs: new Map(),
      codebaseIndex: this.contextManager.getIndex(),
      actionHistory: [],
      sessionMemory: this.memory.export(),
      isRunning: true,
      iterationCount: 0,
      maxIterations: 20,
      config: finalConfig,
    };

    console.log(chalk.green(`✓ Session initialized: ${sessionId}`));
    console.log(chalk.green(`✓ Goal: ${goal}\n`));

    return this.session;
  }

  /**
   * Run the reactor loop: observe -> reason -> plan/execute -> reflect -> learn
   */
  async runReactorLoop(): Promise<void> {
    if (!this.session || !this.tracker || !this.memory || !this.executor || !this.reflectionEngine) {
      throw new Error("Session not initialized. Call initializeSession first.");
    }

    console.log(chalk.cyan("🚀 Starting Reactor Loop\n"));

    while (
      this.session.isRunning &&
      this.session.iterationCount < this.session.maxIterations
    ) {
      this.session.iterationCount++;

      console.log(
        chalk.gray(`\n━ Iteration ${this.session.iterationCount}/${this.session.maxIterations}`)
      );

      try {
        // Phase 1: OBSERVE - Assess current state
        await this.phaseObserve();

        // Phase 2: REASON - Decide what to do next
        const shouldContinue = await this.phaseReason();
        if (!shouldContinue) break;

        // Phase 3: PLAN - For complex tasks, create mutation plan
        const plan = await this.phasePlan();
        if (!plan || plan.steps.length === 0) {
          console.log(chalk.yellow("  No mutation steps planned. Stopping."));
          break;
        }

        // Phase 4: EXECUTE - Execute mutations (hybrid: auto or ask)
        let anyExecuted = false;
        for (const mutation of plan.steps) {
          const shouldExec = await this.executor.shouldExecute(mutation);

          if (shouldExec) {
            const result = await this.executor.execute(mutation);

            this.tracker.log({
              type: mutation.type,
              path: mutation.path,
              details: {
                reasoning: mutation.rationale,
                ...result,
              },
            });

            // Phase 5: VALIDATE - Check if mutation worked
            const actions = this.tracker.getActions();
            const action = actions[actions.length - 1];
            if (!action) {
              console.log(chalk.yellow("  ⚠ No action logged for this mutation."));
              continue;
            }
            const validation = await this.reflectionEngine.validateMutation(action, result);

            if (!validation.valid) {
              console.log(chalk.red(`✗ Mutation failed: ${validation.issues.join(", ")}`));
              this.tracker.updateStatus(action.id, "failed");
            } else {
              console.log(chalk.green(`✓ Mutation succeeded`));
              this.tracker.updateStatus(action.id, "executed");
              anyExecuted = true;
            }
          } else {
            this.tracker.log({
              type: mutation.type,
              path: mutation.path,
              details: {
                reasoning: `User rejected: ${mutation.rationale}`,
              },
            });

            const actions2 = this.tracker.getActions();
            const lastAction = actions2[actions2.length - 1];
            if (lastAction) {
              this.tracker.updateStatus(lastAction.id, "rejected");
            }
          }
        }

        // Phase 6: REFLECT - Learn from actions
        await this.phaseReflect();

        // If we executed something this iteration, check if goal is done
        if (anyExecuted && (await this.isGoalComplete())) {
          console.log(chalk.green("\n✅ Goal completed!\n"));
          this.session.isRunning = false;
          break;
        }

        // If nothing was executed (all rejected or no-ops), stop
        if (!anyExecuted) {
          console.log(chalk.yellow("\n⚠ No mutations executed this iteration. Stopping.\n"));
          break;
        }

      } catch (error) {
        console.error(chalk.red(`Error in iteration ${this.session.iterationCount}:`), error);

        const retry = await confirm({
          message: "Continue?",
          initialValue: true,
        });

        if (!retry) break;
      }
    }

    console.log(chalk.cyan("\n🏁 Reactor Loop Complete\n"));
    this.printSessionSummary();
  }

  // ============ Reactor Phases ============

  private async phaseObserve(): Promise<void> {
    if (!this.contextManager) return;

    console.log(chalk.gray("📍 Phase: OBSERVE"));

    const index = this.contextManager.getIndex();
    console.log(chalk.gray(`  Files indexed: ${index.files.size}`));
    console.log(chalk.gray(`  Frameworks detected: ${index.frameworks.join(", ") || "none"}`));

    if (this.memory) {
      const summary = this.memory.getSummary() as Record<string, unknown>;
      console.log(chalk.gray(`  Cached constraints: ${summary["constraintCount"] ?? 0}`));
    }
  }

  private async phaseReason(): Promise<boolean> {
    if (!this.session) return false;

    console.log(chalk.gray("💭 Phase: REASON"));
    console.log(chalk.gray(`  Goal: ${this.session.goal}`));

    // For now, continue with the plan
    return true;
  }

  private async phasePlan(): Promise<any> {
    if (!this.session || !this.planner) return null;

    console.log(chalk.gray("📋 Phase: PLAN"));

    const plan = await this.planner.createMutationPlan(this.session.goal, {
      codebasePath: this.session.config.codebasePath,
      projectStructure: Array.from(this.session.codebaseIndex.folders.keys()),
      existingFiles: Array.from(this.session.codebaseIndex.files.keys()),
    }, this.modelSelector);

    console.log(chalk.gray(`  Plan steps: ${plan.steps.length}`));
    for (const step of plan.steps) {
      console.log(chalk.gray(`    - Step: type=${step.type}, path=${step.path}, command=${step.command || ""}`));
    }
    console.log(chalk.gray(`  Risk level: ${plan.estimatedRisk}`));

    return plan;
  }

  private async phaseReflect(): Promise<void> {
    if (!this.tracker || !this.memory || !this.session) return;

    console.log(chalk.gray("🔍 Phase: REFLECT"));

    const executed = this.tracker.getExecutedMutations();
    const failed = this.tracker.getFailedMutations();

    console.log(chalk.gray(`  Actions executed: ${executed.length}`));

    if (failed.length > 0) {
      const pattern = this.reflectionEngine?.analyzeFailurePattern(failed);
      if (pattern) {
        this.memory.recordError(pattern.commonIssue, pattern.suggestedFix);
        console.log(chalk.yellow(`  ⚠ Common issue: ${pattern.commonIssue}`));
      }
    }

    // Learn from recent actions
    if (executed.length > 0) {
      const recent = executed[executed.length - 1];
      if (recent) {
        this.memory.addReflection(
          `Executed ${recent.type} on ${recent.path}`,
          "Continue with next step",
          0.8
        );
      }
    }
  }

  // ============ Helper Methods ============

  private async isGoalComplete(): Promise<boolean> {
    // Check if all planned mutations are complete
    if (!this.tracker) return false;

    const pending = this.tracker.getPendingMutations();
    if (pending.length === 0) {
      const executed = this.tracker.getExecutedMutations();
      return executed.length > 0;
    }

    return false;
  }

  private printSessionSummary(): void {
    if (!this.tracker || !this.session) return;

    console.log(chalk.cyan("📊 Session Summary"));
    console.log(chalk.gray(`Session ID: ${this.session.id}`));
    console.log(chalk.gray(`Iterations: ${this.session.iterationCount}`));

    const summary = this.tracker.getSummary();
    console.log(chalk.green(`Total Actions: ${summary.totalActions}`));
    console.log(chalk.green(`Mutations: ${summary.totalMutations}`));
    console.log(chalk.blue(`Executed: ${summary.executed}`));
    console.log(chalk.yellow(`Pending: ${summary.pending}`));
    console.log(chalk.red(`Failed: ${summary.failed}`));
  }
}

const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");

function wrapLine(line: string, width: number): string[] {
  if (line.startsWith("─")) {
    return [line];
  }
  const stripped = stripAnsi(line);
  if (stripped.length <= width) {
    return [line];
  }

  const match = line.match(/^(\s*)/);
  const indent = match ? match[1] : "";

  // Split line by spaces while preserving ANSI sequences
  const tokens = line.trim().match(/(\x1B\[[0-9;]*[a-zA-Z]|[^\s\x1B]+)+/g) || [];
  
  const wrappedLines: string[] = [];
  let currentLine = indent;

  for (const token of tokens) {
    const currentLength = stripAnsi(currentLine).length;
    const tokenLength = stripAnsi(token).length;

    if (currentLine === indent) {
      currentLine += token;
    } else if (currentLength + 1 + tokenLength <= width) {
      currentLine += " " + token;
    } else {
      wrappedLines.push(currentLine);
      currentLine = indent + "  " + token; // indent wrapped parts slightly more
    }
  }

  if (currentLine !== indent) {
    wrappedLines.push(currentLine);
  }

  return wrappedLines.length > 0 ? wrappedLines : [line];
}

function drawBox(title: string, lines: string[], themeColor: (str: string) => string): void {
  const innerWidth = 76;
  const borderTop = themeColor("╭" + "─".repeat(innerWidth + 2) + "╮");
  const borderBottom = themeColor("╰" + "─".repeat(innerWidth + 2) + "╯");
  const divider = themeColor("├" + "─".repeat(innerWidth + 2) + "┤");

  // Format title line with padding
  const titleStr = ` ${title} `;
  const visibleTitleLen = stripAnsi(titleStr).length;
  const titlePadding = Math.max(0, innerWidth - visibleTitleLen);
  const titleLine = themeColor("│ ") + chalk.bold.hex('#e8dcf8')(titleStr) + " ".repeat(titlePadding) + themeColor(" │");

  console.log(borderTop);
  console.log(titleLine);
  console.log(divider);

  const flatLines: string[] = [];
  for (const line of lines) {
    if (line.includes("\n")) {
      flatLines.push(...line.split("\n"));
    } else {
      flatLines.push(line);
    }
  }

  for (const line of flatLines) {
    if (line === "─" || line.startsWith("─")) {
      console.log(divider);
      continue;
    }
    const wrapped = wrapLine(line, innerWidth);
    for (const wLine of wrapped) {
      const visibleLength = stripAnsi(wLine).length;
      const padding = Math.max(0, innerWidth - visibleLength);
      console.log(themeColor("│ ") + wLine + " ".repeat(padding) + themeColor(" │"));
    }
  }
  console.log(borderBottom);
}

import { SwarmCoordinator } from "./swarm/coordinator.js";
import { readConfig } from "../../ai/ai.config.js";

/**
 * Run the full agent mode flow using the Swarm Coordinator
 */
export async function runAgentMode(): Promise<void> {
  console.log(chalk.cyan("\n🐼 Welcome to Swarm Agent Mode!\n"));

  const goal = await text({
    message: "What is your goal?",
    placeholder: "e.g. Create a test file for ActionTracker",
  });

  if (isCancel(goal) || !goal.trim()) {
    console.log(chalk.yellow("No goal provided. Exiting."));
    return;
  }

  let config;
  try {
    config = readConfig();
  } catch (err: any) {
    console.log(chalk.red(`Config error: ${err.message}`));
    return;
  }

  const coordinator = new SwarmCoordinator(config, process.cwd());

  console.log(chalk.gray("\nDecomposing goal into specialized swarm tasks..."));
  
  const result = await coordinator.runSwarm(goal.trim());

  const purpleTheme = chalk.hex('#5b4d9e');

  // Build Swarm Execution Log Box
  const executionLines: string[] = [];
  for (const t of result.tasks) {
    const statusColor = t.status === "completed" ? chalk.green : t.status === "failed" ? chalk.red : chalk.yellow;
    const icon = t.workerType === "researcher" ? "🔍" : t.workerType === "coder" ? "💻" : t.workerType === "verifier" ? "🛡️" : "🎨";
    executionLines.push(`● [${statusColor(t.status.toUpperCase())}] ${chalk.bold(t.name)} (${icon} ${t.workerType})`);
    executionLines.push(`  → Desc: ${chalk.dim(t.description)}`);
    if (t.result) {
      const summaryText = t.result.length > 60 ? t.result.slice(0, 60) + "..." : t.result;
      executionLines.push(`  ✔ Result: ${chalk.gray(summaryText)}`);
    }
    if (t.error) {
      executionLines.push(`  ✖ Error: ${chalk.red(t.error)}`);
    }
    executionLines.push("");
  }
  if (executionLines.length > 0) executionLines.pop(); // remove trailing spacing

  console.log("");
  drawBox("🐝 SWARM EXECUTION LOG", executionLines, purpleTheme);

  // Write full log to workspace file
  const fullResult = result.result;
  const fs = await import("fs");
  const path = await import("path");
  const logDir = path.join(process.cwd(), ".pandaclaw");
  const logPath = path.join(logDir, "latest_swarm_run.md");
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    fs.writeFileSync(logPath, fullResult, "utf8");
  } catch {}

  // Build Swarm Synthesis Summary Box
  const synthesisLines: string[] = [];
  const resLines = fullResult.split("\n");
  for (const line of resLines) {
    synthesisLines.push(line);
  }

  synthesisLines.push("─");
  synthesisLines.push(`📝 Full detailed log saved to: ${chalk.bold.underline(".pandaclaw/latest_swarm_run.md")}`);

  console.log("");
  drawBox("🐼 SWARM SYNTHESIS SUMMARY", synthesisLines, purpleTheme);

  console.log(purpleTheme("\nThanks for using Swarm Agent Mode! 🐼\n"));
}