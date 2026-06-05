// modes/plan/plan-executor.ts
// Sequentially executes each PlanStep, runs tools where specified

import chalk from "chalk";
import type { Plan, PlanStep, PlanExecutionResult } from "../../modes/agent/types.js";
import type { PandaConfig } from "../../ai/ai.config.js";
import { runTool } from "../../tools/index.js";
import { purple as PANDA, lavender as FACE } from "../../utils/brand.js";

async function executeStep(
  step: PlanStep,
  plan: Plan,
  config: PandaConfig
): Promise<string> {
  if (!step.tool) {
    // Pure reasoning step — synthesize a response via Groq
    const apiKey = config.providers.groq.api_key;
    if (!apiKey) {
      return `[Step ${step.index + 1} completed — offline mode, no LLM call]`;
    }

    const res = await fetch(`${config.providers.groq.api_base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.routing.fast_path.model,
        messages: [
          {
            role: "system",
            content: `You are executing step ${step.index + 1} of a plan for the goal: "${plan.goal}". Be concise.`,
          },
          { role: "user", content: step.description },
        ],
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? "(no response)";
  }

  // Tool step — run through the tool registry
  const context = {
    channel: "cli" as const,
    workspacePath: process.cwd(),
    requestConsent: async (tool: string, preview: string) => {
      // In CLI plan mode, we auto-approve tool steps (user already approved the full plan)
      console.log(chalk.gray(`    Auto-approving tool: ${tool}`));
      return true;
    },
  };

  const result = await runTool(step.tool, step.toolArgs ?? {}, context);
  if (!result.success) {
    throw new Error(result.error ?? "Tool execution failed");
  }

  return typeof result.data === "string"
    ? result.data
    : JSON.stringify(result.data, null, 2);
}

export async function executePlan(
  plan: Plan,
  config: PandaConfig
): Promise<PlanExecutionResult> {
  const start = Date.now();
  let stepsCompleted = 0;
  let stepsFailed = 0;
  const stepResults: string[] = [];

  for (const step of plan.steps) {
    step.status = "running";
    console.log(PANDA(`\n  [${step.index + 1}/${plan.steps.length}] ${step.title}`));
    if (step.tool) {
      console.log(chalk.gray(`       Tool: ${step.tool}`));
    }

    try {
      const result = await executeStep(step, plan, config);
      step.status = "done";
      step.result = result;
      stepsCompleted++;
      stepResults.push(`Step ${step.index + 1} (${step.title}): ${result.slice(0, 200)}`);
      console.log(chalk.green(`  ✓ Done`));
    } catch (err: unknown) {
      step.status = "failed";
      stepsFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`  ✗ Failed: ${msg}`));
      stepResults.push(`Step ${step.index + 1} (${step.title}): FAILED — ${msg}`);
    }
  }

  // Synthesize a final answer from all step results
  const finalAnswer = await synthesizeFinalAnswer(plan.goal, stepResults, config);

  return {
    planId: plan.id,
    goal: plan.goal,
    finalAnswer,
    stepsCompleted,
    stepsFailed,
    verified: stepsFailed === 0,
    durationMs: Date.now() - start,
  };
}

async function synthesizeFinalAnswer(
  goal: string,
  stepResults: string[],
  config: PandaConfig
): Promise<string> {
  const apiKey = config.providers.groq.api_key;
  if (!apiKey || stepResults.length === 0) {
    return stepResults.join("\n\n") || "Plan completed.";
  }

  const summaryPrompt = `Goal: "${goal}"

Step results:
${stepResults.join("\n")}

Based on these results, provide a concise final summary of what was accomplished.`;

  try {
    const res = await fetch(`${config.providers.groq.api_base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.routing.fast_path.model,
        messages: [{ role: "user", content: summaryPrompt }],
        max_tokens: 512,
        temperature: 0.2,
      }),
    });

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? stepResults.join("\n\n");
  } catch {
    return stepResults.join("\n\n");
  }
}
