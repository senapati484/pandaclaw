import chalk from "chalk";
import { text, confirm } from "@clack/prompts";
import { randomUUID } from "crypto";
import type { Plan } from "./types";
import { PlanTracker } from "./plan-tracker";
import { SessionMemoryManager } from "./session-memory";
import { ModelSelector } from "./model-selector";
import { PlanGenerator } from "./plan-generator";
import { PlanValidator } from "./plan-validator";
import { PlanOptimizer } from "./plan-optimizer";

export class PlanOrchestrator {
  private plan: Plan | null = null;
  private tracker: PlanTracker;
  private memory: SessionMemoryManager;
  private modelSelector: ModelSelector;
  private generator: PlanGenerator;
  private validator: PlanValidator;
  private optimizer: PlanOptimizer;

  constructor() {
    this.tracker = new PlanTracker();
    this.memory = new SessionMemoryManager();
    this.modelSelector = new ModelSelector();
    this.generator = new PlanGenerator();
    this.validator = new PlanValidator();
    this.optimizer = new PlanOptimizer();
  }

  async initializeSession(goal: string): Promise<Plan> {
    console.log(chalk.cyan("\n🐼 Initializing Planner Session...\n"));

    // 1. Generate plan
    const initialPlan = await this.generator.generatePlan(goal, undefined, this.modelSelector);

    // 2. Validate
    const validation = this.validator.validate(initialPlan.tasks, this.memory);
    initialPlan.validation = validation;

    // 3. Optimize
    const optimization = this.optimizer.optimize(initialPlan.tasks);
    initialPlan.optimization = optimization;

    // Update status to validated if valid
    initialPlan.status = validation.valid ? "validated" : "draft";

    this.plan = initialPlan;
    this.tracker.recordPlan(initialPlan);

    return this.plan;
  }

  async runPlanningLoop(): Promise<void> {
    if (!this.plan) {
      throw new Error("Plan session not initialized.");
    }

    console.log(chalk.cyan("🚀 Starting Planning Pipeline...\n"));

    // Phase 1: Understand & Decompose
    console.log(chalk.gray("📍 Phase 1: UNDERSTAND & DECOMPOSE"));
    console.log(chalk.gray(`  Goal: ${this.plan.goal}`));
    console.log(chalk.gray(`  Decomposed into ${this.plan.tasks.length} tasks.`));

    // Phase 2: Validate
    console.log(chalk.gray("\n📍 Phase 2: VALIDATE"));
    if (this.plan.validation?.valid) {
      console.log(chalk.green("  ✓ Plan validated successfully. No dependency cycles or missing targets."));
    } else {
      console.log(chalk.red("  ✗ Plan validation failed. Issues:"));
      this.plan.validation?.issues.forEach((issue) => console.log(chalk.red(`    - ${issue}`)));
    }

    // Phase 3: Optimize
    console.log(chalk.gray("\n📍 Phase 3: OPTIMIZE"));
    if (this.plan.optimization) {
      console.log(chalk.gray(`  Original cumulative effort: ${this.plan.optimization.originalEffort} hours`));
      console.log(chalk.gray(`  Optimized (critical path) effort: ${this.plan.optimization.optimizedEffort} hours`));
      console.log(chalk.gray(`  Critical Path sequence: ${this.plan.optimization.criticalPath.join(" -> ")}`));
      console.log(chalk.gray(`  Execution Levels (Parallel Groups):`));
      this.plan.optimization.parallelGroups.forEach((group, idx) => {
        console.log(chalk.gray(`    Level ${idx + 1}: ${group.join(", ")}`));
      });
    }

    // Phase 4: Output Markdown
    console.log(chalk.cyan("\n📊 Plan Document Generated:\n"));
    this.printPlanSummary();
  }

  private printPlanSummary(): void {
    if (!this.plan || !this.plan.optimization) return;

    console.log(chalk.green(`=======================================================`));
    console.log(chalk.green(`PLAN DOCUMENT: ${this.plan.goal}`));
    console.log(chalk.green(`=======================================================`));
    console.log(chalk.gray(`Plan ID: ${this.plan.id} | Version: ${this.plan.version} | Status: ${this.plan.status}`));
    console.log(chalk.gray(`Estimated Effort: ${this.plan.estimatedEffort} hours (Optimized: ${this.plan.optimization.optimizedEffort} hours)`));
    console.log(chalk.gray(`Estimated Risk: ${this.plan.estimatedRisk}`));
    console.log(chalk.green("\nTasks:"));

    for (const t of this.plan.tasks) {
      console.log(chalk.green(`\n- [${t.id}] ${t.description}`));
      console.log(chalk.gray(`  Type: ${t.type} | Effort: ${t.effort}h | Risk: ${t.riskLevel}`));
      console.log(chalk.gray(`  Dependencies: ${t.dependencies.length > 0 ? t.dependencies.join(", ") : "none"}`));
      console.log(chalk.gray(`  Success Criteria:`));
      t.successCriteria.forEach(sc => console.log(chalk.gray(`    * ${sc}`)));
    }

    console.log(chalk.green("\nOptimized Levels (Parallel Execution):"));
    this.plan.optimization.parallelGroups.forEach((group, idx) => {
      console.log(chalk.gray(`  Level ${idx + 1}: ${group.join(", ")}`));
    });
    console.log(chalk.green(`=======================================================`));
  }
}

/**
 * CLI Runner for Plan Mode
 */
export async function runPlanMode(): Promise<void> {
  console.log(chalk.cyan("\n🐼 Welcome to Plan Mode!\n"));

  const goal = await text({
    message: "What project goal do you want to plan?",
    placeholder: "e.g. Implement user login database migration"
  });

  if (typeof goal === "symbol" || !goal.trim()) {
    console.log(chalk.yellow("Plan generation cancelled."));
    return;
  }

  const orchestrator = new PlanOrchestrator();
  await orchestrator.initializeSession(goal.trim());
  await orchestrator.runPlanningLoop();

  const shouldExecute = await confirm({
    message: "Would you like to execute this plan now?",
    initialValue: true,
  });

  if (shouldExecute && typeof shouldExecute !== "symbol") {
    const { AgentOrchestrator } = await import("../agent/orchestrator.js");
    const agentOrchestrator = new AgentOrchestrator();
    await agentOrchestrator.initializeSession(goal.trim());
    await agentOrchestrator.runReactorLoop();
  }

  console.log(chalk.cyan("\nThanks for using Plan Mode! 🐼\n"));
}
