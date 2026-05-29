// modes/plan/orchestrator.ts
// Plan Mode CLI — goal → generate plan → display → confirm → execute

import chalk from "chalk";
import { text, confirm } from "@clack/prompts";
import type { Plan } from "../../modes/agent/types.js";
import { generatePlan } from "./plan-generator.js";
import { executePlan } from "./plan-executor.js";
import { readConfig } from "../../ai/ai.config.js";

const PANDA = chalk.hex("#5b4d9e");
const FACE  = chalk.hex("#e8dcf8");

function displayPlan(plan: Plan): void {
  console.log(PANDA(`\n📋 Plan for: "${plan.goal}"\n`));
  console.log(
    chalk.gray(`   Complexity: ${plan.estimatedComplexity} · ${plan.steps.length} steps\n`)
  );

  for (const step of plan.steps) {
    const icon = step.tool ? "🔧" : "💭";
    console.log(FACE(`  ${step.index + 1}. ${icon} ${step.title}`));
    console.log(chalk.gray(`     ${step.description}`));
    if (step.tool) {
      console.log(chalk.gray(`     Tool: ${step.tool}`));
    }
    if (step.dependsOn && step.dependsOn.length > 0) {
      console.log(chalk.gray(`     Depends on: steps ${step.dependsOn.map((d) => d + 1).join(", ")}`));
    }
    console.log();
  }
}

export async function runPlanMode(): Promise<void> {
  const config = readConfig();

  console.log(PANDA("\n🐼 Plan Mode — I plan before I act\n"));
  console.log(FACE("  Tell me your goal. I'll break it into steps,"));
  console.log(FACE("  show you the plan, then execute with your approval.\n"));

  const goalInput = await text({
    message: "What's your goal?",
    placeholder: "e.g. Add user authentication to my Express app",
    validate: (v: string | undefined) => (!v || v.trim().length < 5 ? "Please describe your goal" : undefined),
  });

  // Handle cancel
  if (!goalInput || typeof goalInput === "symbol") {
    console.log(PANDA("\nMaybe later, panda...\n"));
    return;
  }

  const goal = goalInput.trim();

  // Generate plan
  console.log(PANDA("\n🐼 Planning...\n"));

  let plan: Plan;
  try {
    plan = await generatePlan(goal, config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\n  ❌ Error generating plan: ${msg}\n`));
    return;
  }

  // Show the plan
  displayPlan(plan);

  const shouldProceed = await confirm({ message: "Execute this plan?" });

  if (!shouldProceed || typeof shouldProceed === "symbol") {
    console.log(PANDA("\nPlan saved. Revisit plan mode to execute.\n"));
    return;
  }

  // Execute
  console.log(PANDA("\n🚀 Executing plan...\n"));
  const result = await executePlan(plan, config);

  console.log(PANDA(`\n✅ Plan complete!\n`));
  console.log(FACE("Result:\n"));
  console.log(result.finalAnswer);
  console.log();
  console.log(
    chalk.gray(
      `  Steps: ${result.stepsCompleted} done · ${result.stepsFailed} failed · ${result.durationMs}ms`
    )
  );
  console.log();

  console.log(PANDA("Thanks for using Plan Mode! 🐼\n"));
}
