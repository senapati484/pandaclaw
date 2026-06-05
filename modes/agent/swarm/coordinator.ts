import type { SwarmTask, SwarmContext } from "./types.js";
import type { PandaConfig } from "../../../ai/ai.config.js";
import { SwarmWorker } from "./worker.js";
import { callLLM } from "../../../ai/llm.js";
import { ActionTracker } from "../action-tracker.js";
import { ActionHistory } from "../action-history.js";
import { SessionMemoryManager } from "../session-memory.js";
import { getSessionManager } from "../session-manager.js";
import { Logger } from "../../../utils/logger.js";
import chalk from "chalk";
import { confirm } from "@clack/prompts";

// Role-specific token budgets — researcher/verifier are cheap fact-finders,
// only coder truly needs a large context window for code generation.
const WORKER_TOKEN_BUDGETS: Record<string, number> = {
  researcher:  1024,  // returns facts, doesn't need to write code
  coder:       4096,  // needs space for multi-file code reasoning
  verifier:    512,   // short verdict: pass/fail + reason
  visualizer:  768,   // spatial description, brief
};

// Model routing per role — use Groq (fast + free) for light roles,
// reserve DeepSeek R1 (slow + expensive) only for the coder role.
const WORKER_MODEL_ROUTE: Record<string, { provider: string; model: string }> = {
  researcher:  { provider: "groq",       model: "llama-3.3-70b-versatile" },
  coder:       { provider: "openrouter", model: "deepseek/deepseek-r1" },
  verifier:    { provider: "groq",       model: "llama-3.3-70b-versatile" },
  visualizer:  { provider: "groq",       model: "llama-3.3-70b-versatile" },
};

export class SwarmCoordinator {
  private config: PandaConfig;
  private workspacePath: string;
  private sessionId: string | null = null;
  private tracker: ActionTracker;
  private actionHistory: ActionHistory;
  private memory: SessionMemoryManager;

  constructor(config: PandaConfig, workspacePath: string, sessionId?: string) {
    this.config = config;
    this.workspacePath = workspacePath;
    this.sessionId = sessionId || null;

    this.tracker = new ActionTracker();
    const logger = new Logger("action-history", ".pandaclaw");
    this.actionHistory = new ActionHistory(workspacePath, logger);
    this.memory = new SessionMemoryManager(sessionId);

    if (this.sessionId) {
      const sm = getSessionManager();
      const stored = sm.loadSession(this.sessionId);
      if (stored) {
        if (stored.actions && stored.actions.length > 0) {
          this.tracker.import(stored.actions);
        }
        if (stored.memory) {
          this.memory.import(stored.memory);
        }
      }
    }
  }

  public persistSwarmState(): void {
    if (this.sessionId) {
      const sm = getSessionManager();
      sm.saveActions(this.sessionId, this.tracker.export());
      sm.saveMemory(this.sessionId, this.memory.export());
    }
  }

  public async offerSwarmUndo(): Promise<void> {
    const historySize = this.actionHistory.undoCount();
    if (historySize > 0) {
      const undoChoice = await confirm({
        message: `Undo the last mutation? (${historySize} changes in stack)`,
        initialValue: false,
      });
      if (undoChoice) {
        const undone = this.actionHistory.undo();
        if (undone.success) {
          console.log(chalk.green(`  ✓ ${undone.description}`));
        } else {
          console.log(chalk.yellow(`  ${undone.description}`));
        }
      }
    }
  }

  private buildFallbackTasks(goals: string): SwarmTask[] {
    return [
      {
        id: "task_research",
        name: "Research Goal",
        description: `Research the workspace and details needed for: "${goals}"`,
        workerType: "researcher",
        dependencies: [],
        status: "pending",
      },
      {
        id: "task_code",
        name: "Code Implementation",
        description: `Implement coding logic for: "${goals}"`,
        workerType: "coder",
        dependencies: ["task_research"],
        status: "pending",
      },
      {
        id: "task_verify",
        name: "Code Verification",
        description: `Verify and run tests to ensure correctness of: "${goals}"`,
        workerType: "verifier",
        dependencies: ["task_code"],
        status: "pending",
      },
    ];
  }

  private async runReadyTasks(
    readyTasks: SwarmTask[],
    context: SwarmContext,
    onProgress?: (message: string) => void
  ): Promise<void> {
    const runPromises = readyTasks.map(async (t) => {
      if (onProgress) {
        onProgress(`Running ${t.workerType} task: ${t.name}...`);
      }
      const maxTokens = WORKER_TOKEN_BUDGETS[t.workerType] ?? 1024;
      const worker = new SwarmWorker(t.workerType, this.config, maxTokens);
      const updated = await worker.run(t, context, onProgress);
      context.tasks.set(t.id, updated);
      if (updated.status === "completed" && updated.result) {
        context.history.push(`Task [${updated.name}] result: ${updated.result}`);
      }
    });
    await Promise.all(runPromises);
  }

  public async runSwarm(
    goals: string,
    onProgress?: (message: string) => void
  ): Promise<{ success: boolean; result: string; tasks: SwarmTask[] }> {
    const context: SwarmContext = {
      workspacePath: this.workspacePath,
      goals,
      tasks: new Map<string, SwarmTask>(),
      history: [],
      tracker: this.tracker,
      actionHistory: this.actionHistory,
      memory: this.memory,
      sessionId: this.sessionId || undefined,
    };

    // 1. Generate dependency tasks via LLM or fall back to basic template
    try {
      const generatedTasks = await this.decomposeGoal(goals);
      for (const t of generatedTasks) {
        context.tasks.set(t.id, t);
      }
    } catch {
      for (const t of this.buildFallbackTasks(goals)) {
        context.tasks.set(t.id, t);
      }
    }

    // 2. Loop until all tasks complete or fail
    let loopCount = 0;
    const maxLoops = 20;

    while (loopCount < maxLoops) {
      const pendingTasks = Array.from(context.tasks.values()).filter(t => t.status === "pending");
      const inProgressTasks = Array.from(context.tasks.values()).filter(t => t.status === "in_progress");

      if (pendingTasks.length === 0 && inProgressTasks.length === 0) {
        break;
      }

      // Filter tasks whose dependencies are fully completed
      const readyTasks = pendingTasks.filter(t => {
        return (t.dependencies || []).every(depId => {
          const depTask = context.tasks.get(depId);
          return depTask && depTask.status === "completed";
        });
      });

      if (readyTasks.length === 0 && inProgressTasks.length === 0) {
        break; // deadlock/cycle fallback
      }

      await this.runReadyTasks(readyTasks, context, onProgress);
      loopCount++;
    }

    // 3. Synthesize summary
    const allTasks = Array.from(context.tasks.values());
    const failedTasks = allTasks.filter(t => t.status === "failed");
    const resultSummary = await this.synthesizeSummary(goals, allTasks);

    return {
      success: failedTasks.length === 0,
      result: resultSummary,
      tasks: allTasks,
    };
  }

  private async decomposeGoal(goals: string): Promise<SwarmTask[]> {
    const prompt = `Goal: "${goals}"

Decompose this goal into a dependency tree of specialized sub-tasks.
CRITICAL: Be extremely minimal. Optimize for speed and API roundtrips. A single worker (e.g. coder or researcher) can read, search, and modify files within its own reasoning loop. Do NOT split a task into separate planning, research, and coding tasks unless absolutely necessary. Usually, 1 or 2 tasks is the maximum required for simple goals.

Each task must be assigned to one of the following worker types:
- researcher (for file reading, web search, info gathering)
- coder (for code writing, file modification)
- verifier (for sanity checking, verification, testing)
- visualizer (for design, spatial analysis)

Output a JSON array of tasks matching this schema:
[
  {
    "id": "task_unique_id",
    "name": "Short Task Name",
    "description": "Specific instruction for the worker",
    "workerType": "researcher" | "coder" | "verifier" | "visualizer",
    "dependencies": ["other_task_id"]
  }
]
Reply ONLY with the JSON block. Do not wrap in markdown tags.`;

    const data = await callLLM(this.config, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
      temperature: 0.1,
    });

    let content = data.choices?.[0]?.message?.content ?? "";
    content = content.replace(/```json/i, "").replace(/```/g, "").trim();

    const tasks = JSON.parse(content) as any[];
    return tasks.map(t => ({
      dependencies: [],
      ...t,
      status: "pending",
    }));
  }

  private async synthesizeSummary(goals: string, tasks: SwarmTask[]): Promise<string> {
    const taskStates = tasks.map(t => {
      return `- Task [${t.name}] (${t.workerType}) status: ${t.status}\n  Result: ${t.result || t.error || "N/A"}`;
    }).join("\n");

    const prompt = `Goal: "${goals}"

Here are the results of the sub-tasks:
${taskStates}

Synthesize a final unified response summarizing the final outcome.`;

    try {
      const data = await callLLM(this.config, {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
        temperature: 0.2,
      });

      return data.choices?.[0]?.message?.content ?? "Swarm task completed.";
    } catch {
      return "Swarm execution summary generated.";
    }
  }
}
