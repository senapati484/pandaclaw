import chalk from "chalk";
import { select, isCancel, text, confirm, spinner } from "@clack/prompts";
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
import { ActionHistory } from "./action-history";
import { Logger } from "../../utils/logger";
import { formatAfterMutation } from "../../tools/code-formatter";
import { runTestsForChangedFiles } from "./test-runner";
import { SessionManager, getSessionManager } from "./session-manager";
import type { SessionData } from "./session-manager";
import { stripAnsi, wrapLine, drawBox } from "../../utils/terminal-ui";

class AgentOrchestrator {
  private session: ReactorSession | null = null;
  private tracker: ActionTracker | null = null;
  private memory: SessionMemoryManager | null = null;
  private contextManager: CodebaseContextManager | null = null;
  private modelSelector: ModelSelector;
  private executor: MutationExecutor | null = null;
  private reflectionEngine: ReflectionEngine | null = null;
  private planner: ActionPlanner;
  private actionHistory: ActionHistory | null = null;
  private logger: Logger;

  constructor() {
    this.modelSelector = new ModelSelector();
    this.planner = new ActionPlanner();
    this.logger = new Logger("orchestrator", ".pandaclaw");
  }

  /**
   * Initialize a new agent session
   */
  async initializeSession(goal: string, config?: AgentConfig, existingSessionId?: string): Promise<ReactorSession> {
    console.log(chalk.cyan("\n🐼 Initializing Agent Session...\n"));

    const finalConfig = config || defaultAgentConfig();
    const sessionId = existingSessionId || randomUUID();
    const sm = getSessionManager();

    // Initialize components
    this.tracker = new ActionTracker();
    this.memory = new SessionMemoryManager(sessionId);
    this.contextManager = new CodebaseContextManager(
      finalConfig.codebasePath,
      finalConfig.maxFileSizeToRead
    );
    this.executor = new MutationExecutor(finalConfig.codebasePath, finalConfig);
    this.reflectionEngine = new ReflectionEngine(finalConfig.codebasePath);
    const histLogger = new Logger("action-history", ".pandaclaw");
    this.actionHistory = new ActionHistory(finalConfig.codebasePath, histLogger);

    // Index codebase
    console.log(chalk.gray("Indexing codebase..."));
    await this.contextManager.indexCodebase();

    // Restore from persistent session if resuming
    if (existingSessionId) {
      const stored = sm.loadSession(existingSessionId);
      if (stored) {
        if (stored.actions.length > 0) {
          this.tracker.import(stored.actions);
        }
        if (stored.memory) {
          this.memory.import(stored.memory);
        }
        console.log(chalk.green(`✓ Restored session: ${stored.data.name}\n`));
      }
    } else {
      sm.createSession(goal.slice(0, 60), goal, finalConfig.codebasePath, finalConfig);
    }

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
      maxIterations: finalConfig.approvalThresholds?.autoExecuteMutationLimit || 20,
      config: finalConfig,
    };

    console.log(chalk.green(`✓ Session initialized: ${sessionId}`));
    console.log(chalk.green(`✓ Goal: ${goal}\n`));

    return this.session;
  }

  /**
   * Run the reactor loop: observe -> reason -> plan/execute -> reflect -> learn
   */
  private async executeReactorIteration(): Promise<boolean> {
    if (!this.session || !this.tracker || !this.reflectionEngine) return false;

    // Phase 1: OBSERVE - Assess current state
    await this.phaseObserve();

    // Phase 2: REASON - Decide what to do next
    const shouldContinue = await this.phaseReason();
    if (!shouldContinue) return false;

    // Phase 3: PLAN - For complex tasks, create mutation plan
    const plan = await this.phasePlan();
    if (!plan || plan.steps.length === 0) {
      console.log(chalk.yellow("  No mutation steps planned. Stopping."));
      return false;
    }

    // Phase 4: EXECUTE - Execute mutations (hybrid: auto or ask)
    let anyExecuted = false;
    for (const mutation of plan.steps) {
      const executed = await this.executeMutationStep(mutation);
      if (executed) {
        anyExecuted = true;
      }
    }

    // Phase 6: REFLECT - Learn from actions
    await this.phaseReflect();

    // Persist session state
    this.persistSession();

    // If we executed something this iteration, check if goal is done
    if (anyExecuted && (await this.isGoalComplete())) {
      console.log(chalk.green("\n✅ Goal completed!\n"));
      this.session.isRunning = false;
      return false;
    }

    // If nothing was executed (all rejected or no-ops), stop
    if (!anyExecuted) {
      console.log(chalk.yellow("\n⚠ No mutations executed this iteration. Stopping.\n"));
      return false;
    }

    return true;
  }

  private async handleReactorError(error: any): Promise<boolean> {
    if (!this.session) return false;
    console.error(chalk.red(`Error in iteration ${this.session.iterationCount}:`), error);

    const retry = await confirm({
      message: "Continue?",
      initialValue: true,
    });

    return !!retry;
  }

  private async offerUndoOption(): Promise<void> {
    if (this.actionHistory) {
      const historySize = this.actionHistory.undoCount();
      if (historySize > 0) {
        const undoChoice = await confirm({
          message: "Undo the last mutation?",
          initialValue: false,
        });
        if (undoChoice) {
          const undone = await this.actionHistory.undo();
          if (undone) {
            console.log(chalk.green(`  ✓ ${undone.description}`));
          } else {
            console.log(chalk.yellow("  Nothing to undo."));
          }
        }
      }
    }
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
        const shouldContinue = await this.executeReactorIteration();
        if (!shouldContinue) break;
      } catch (error) {
        const retry = await this.handleReactorError(error);
        if (!retry) break;
      }
    }

    console.log(chalk.cyan("\n🏁 Reactor Loop Complete\n"));
    this.printSessionSummary();

    await this.offerUndoOption();
  }

  private async executeMutationStep(mutation: any): Promise<boolean> {
    if (!this.session || !this.tracker || !this.executor || !this.reflectionEngine) return false;

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
        return false;
      }
      const validation = await this.reflectionEngine.validateMutation(action, result);

      if (!validation.valid) {
        console.log(chalk.red(`✗ Mutation failed: ${validation.issues.join(", ")}`));
        this.tracker.updateStatus(action.id, "failed");
        return false;
      } else {
        console.log(chalk.green(`✓ Mutation succeeded`));
        this.tracker.updateStatus(action.id, "executed");

        // Git auto-commit if validation passes
        if (this.executor) {
          await this.executor.autoCommit(mutation);
        }

        // Post-mutation: snapshot for undo/redo
        if (this.actionHistory && mutation.type !== "shell_command" && mutation.type !== "folder_delete") {
          this.actionHistory.snapshotBefore(mutation.path, mutation.type, mutation.rationale);
        }

        // Post-mutation: auto-format if formatter detected (async, non-blocking)
        void Promise.resolve().then(() => {
          try {
            formatAfterMutation(mutation.path, this.session!.config.codebasePath);
          } catch {}
        });

        // Post-mutation: run tests for affected files (async, non-blocking)
        void Promise.resolve().then(() => {
          try {
            runTestsForChangedFiles(this.session!.config.codebasePath, [mutation.path]);
          } catch {}
        });
        return true;
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
      return false;
    }
  }

  // ============ Reactor Phases ============

  private async phaseObserve(): Promise<void> {
    if (!this.contextManager) return;

    console.log(chalk.gray("📍 Phase: OBSERVE"));

    const index = this.contextManager.getIndex();
    console.log(chalk.gray(`  Files indexed: ${index.files.size}`));
    console.log(chalk.gray(`  Frameworks detected: ${index.frameworks.join(", ") || "none"}`));

    if (this.memory) {
      const mem = this.memory.export();
      console.log(chalk.gray(`  Cached constraints: ${mem.learnedConstraints.length}`));
    }
  }

  private async phaseReason(): Promise<boolean> {
    if (!this.session) return false;

    console.log(chalk.gray("💭 Phase: REASON"));

    const goal = this.session.goal;
    const iterations = this.session.iterationCount;
    const executedActions = this.tracker?.getExecutedMutations() ?? [];
    const failedActions = this.tracker?.getFailedMutations() ?? [];

    // Check for goal completion signal based on action results
    if (failedActions.length > 3) {
      console.log(chalk.yellow("  ⚠ Too many failures. Stopping."));
      return false;
    }

    // After 3+ empty iterations with no failures, stop
    if (iterations > 3 && executedActions.length === 0 && failedActions.length === 0) {
      console.log(chalk.yellow("  ⚠ No progress detected. Stopping."));
      return false;
    }

    console.log(chalk.gray(`  Goal: ${goal}`));
    console.log(chalk.gray(`  Executed: ${executedActions.length}, Failed: ${failedActions.length}`));

    return true;
  }

  private async phasePlan(): Promise<import("./types.js").MutationPlan | null> {
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
    if (!this.tracker) return false;

    const pending = this.tracker.getPendingMutations();
    if (pending.length === 0) {
      const executed = this.tracker.getExecutedMutations();
      return executed.length > 0;
    }

    return false;
  }

  private persistSession(): void {
    if (!this.session || !this.tracker || !this.memory) return;

    try {
      const sm = getSessionManager();
      sm.saveSession(this.session.id, {
        iterationCount: this.session.iterationCount,
        status: this.session.isRunning ? "active" : "paused",
      } as any);
      sm.saveActions(this.session.id, this.tracker.export());
      sm.saveMemory(this.session.id, this.memory.export());
    } catch (err: any) {
      // Non-critical — don't break the loop, but surface it for debugging
      this.logger.warn(`persistSession failed: ${err?.message ?? String(err)}`);
    }
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


import { SwarmCoordinator } from "./swarm/coordinator.js";
import { readConfig } from "../../ai/ai.config.js";


/**
 * Run the full agent mode flow with session support
 */
async function promptResumeSession(sm: SessionManager): Promise<{ resumeSessionId?: string; goalText?: string } | null> {
  const existing = sm.listSessions();
  if (existing.length === 0) return {};
  const resumeChoice = await select({
    message: "Resume an existing session or start fresh?",
    options: [
      { value: "fresh", label: "Start new session" },
      ...existing.slice(0, 10).map((s) => ({
        value: s.id,
        label: `${s.name} — ${s.goal.slice(0, 50)} [${s.status}]`,
      })),
      { value: "cancel", label: "Cancel" },
    ],
  });

  if (isCancel(resumeChoice) || resumeChoice === "cancel") return null;

  if (resumeChoice !== "fresh") {
    const resumeSessionId = resumeChoice as string;
    const stored = sm.loadSession(resumeSessionId);
    if (stored) {
      console.log(chalk.gray(`Resuming session: ${stored.data.name} (${stored.data.id})`));
      return { resumeSessionId, goalText: stored.data.goal };
    }
  }
  return {};
}

function buildSwarmExecutionLines(tasks: any[]): string[] {
  const executionLines: string[] = [];
  for (const t of tasks) {
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
  return executionLines;
}

async function saveSwarmLog(fullResult: string): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");
  const logDir = path.join(process.cwd(), ".pandaclaw");
  const logPath = path.join(logDir, "latest_swarm_run.md");
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    fs.writeFileSync(logPath, fullResult, "utf8");
  } catch {}
}

export async function runAgentMode(): Promise<void> {
  console.log(chalk.cyan("\n🐼 Welcome to Swarm Agent Mode!\n"));

  const sm = getSessionManager();
  const sessionPromptResult = await promptResumeSession(sm);
  if (sessionPromptResult === null) return;

  const resumeSessionId = sessionPromptResult.resumeSessionId;
  let goalText = sessionPromptResult.goalText || "";

  if (!resumeSessionId) {
    const goalInput = await text({
      message: "What is your goal?",
      placeholder: "e.g. Create a test file for ActionTracker",
    });

    if (isCancel(goalInput) || !(goalInput as string).trim()) {
      console.log(chalk.yellow("No goal provided. Exiting."));
      return;
    }
    goalText = goalInput as string;
  }

  let config;
  try {
    config = readConfig();
  } catch (err: any) {
    console.log(chalk.red(`Config error: ${err.message}`));
    return;
  }

  let sessionId = resumeSessionId;
  if (!sessionId) {
    const session = sm.createSession(
      goalText.trim().slice(0, 60),
      goalText.trim(),
      process.cwd(),
      defaultAgentConfig()
    );
    sessionId = session.id;
  }

  // Record user query in session message history
  sm.addMessage(sessionId, "user", goalText.trim());

  const coordinator = new SwarmCoordinator(config, process.cwd(), sessionId);

  const s = spinner();
  s.start("Decomposing goal into specialized swarm tasks...");
  
  const result = await coordinator.runSwarm(goalText.trim(), (msg) => {
    s.message(msg);
  });

  s.stop("Swarm execution completed");

  const purpleTheme = chalk.hex('#5b4d9e');

  const executionLines = buildSwarmExecutionLines(result.tasks);
  console.log("");
  drawBox("🐝 SWARM EXECUTION LOG", executionLines, purpleTheme);

  const fullResult = result.result;
  await saveSwarmLog(fullResult);

  // Record assistant synthesis in session message history
  sm.addMessage(sessionId, "assistant", fullResult);

  // Save latest actions & memory state, and update status
  sm.updateStatus(sessionId, result.success ? "completed" : "failed");
  coordinator.persistSwarmState();

  // Build Swarm Synthesis Summary Box
  const synthesisLines: string[] = fullResult.split("\n");
  synthesisLines.push("─");
  synthesisLines.push(`📝 Full detailed log saved to: ${chalk.bold.underline(".pandaclaw/latest_swarm_run.md")}`);

  console.log("");
  drawBox("🐼 SWARM SYNTHESIS SUMMARY", synthesisLines, purpleTheme);

  console.log(purpleTheme("\nThanks for using Swarm Agent Mode! 🐼\n"));

  // Offer undo if modifications were made
  await coordinator.offerSwarmUndo();
}