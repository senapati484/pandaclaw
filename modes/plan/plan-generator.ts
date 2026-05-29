// modes/plan/plan-generator.ts
// Generates a structured Plan from a goal using OpenRouter (DeepSeek) or offline fallback

import type { Plan, PlanStep } from "../../modes/agent/types.js";
import type { PandaConfig } from "../../ai/ai.config.js";

interface LLMResponse {
  choices: Array<{ message: { content: string } }>;
}

interface RawStep {
  index?: number;
  title?: string;
  description?: string;
  tool?: string | null;
  toolArgs?: Record<string, unknown> | null;
  dependsOn?: number[];
}

interface RawPlan {
  steps?: RawStep[];
  estimatedComplexity?: "low" | "medium" | "high";
}

function buildPrompt(goal: string): string {
  return `You are PandaClaw's planning engine.

Break this goal into clear, ordered implementation steps:
"${goal}"

Each step must be specific and actionable.
If a step needs a tool, specify it in the "tool" field.

Available tools: web_search, web_fetch, file_read, file_write, code_exec, shell_command

Reply ONLY with valid JSON (no markdown, no explanation):
{
  "steps": [
    {
      "index": 0,
      "title": "Short step name",
      "description": "What specifically to do in this step",
      "tool": "tool_name or null",
      "toolArgs": {} or null,
      "dependsOn": []
    }
  ],
  "estimatedComplexity": "low|medium|high"
}`;
}

function offlinePlan(goal: string): Plan {
  const goalLower = goal.toLowerCase();

  // Heuristic: 3 generic steps for any goal
  const steps: PlanStep[] = [
    {
      index: 0,
      title: "Understand requirements",
      description: `Analyze the goal: "${goal}" and identify what needs to be done.`,
      tool: null,
      dependsOn: [],
      status: "pending",
    },
    {
      index: 1,
      title: "Plan implementation",
      description: "Define sub-tasks and dependencies.",
      tool: null,
      dependsOn: [0],
      status: "pending",
    },
    {
      index: 2,
      title: "Execute",
      description: `Carry out the plan for: "${goal}".`,
      tool: goalLower.includes("search") ? "web_search" : goalLower.includes("file") ? "file_write" : null,
      dependsOn: [1],
      status: "pending",
    },
  ];

  return {
    id: crypto.randomUUID(),
    goal,
    steps,
    estimatedComplexity: "medium",
    createdAt: new Date(),
  };
}

export async function generatePlan(goal: string, config: PandaConfig): Promise<Plan> {
  const orKey = config.providers.openrouter.api_key;

  // Offline fallback
  if (!orKey) {
    return offlinePlan(goal);
  }

  const { model, maxTokens, temperature } = config.routing.planning;

  const res = await fetch(`${config.providers.openrouter.api_base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${orKey}`,
      "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
      "X-Title": "PandaClaw",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildPrompt(goal) }],
      max_tokens: maxTokens,
      temperature,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    throw new Error(`Plan generation failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as LLMResponse;
  const raw = data.choices[0]?.message?.content ?? "{}";
  const cleaned = raw.replace(/^```(json)?|```$/gm, "").trim();

  let parsed: RawPlan;
  try {
    parsed = JSON.parse(cleaned) as RawPlan;
  } catch {
    return offlinePlan(goal);
  }

  const steps: PlanStep[] = (parsed.steps ?? []).map((s: RawStep, i: number) => ({
    index: s.index ?? i,
    title: s.title ?? `Step ${i + 1}`,
    description: s.description ?? "",
    tool: s.tool ?? null,
    toolArgs: s.toolArgs ?? null,
    dependsOn: s.dependsOn ?? [],
    status: "pending" as const,
  }));

  return {
    id: crypto.randomUUID(),
    goal,
    steps,
    estimatedComplexity: parsed.estimatedComplexity ?? "medium",
    createdAt: new Date(),
  };
}

// ── Backward-compatible class API (used by plan.test.ts) ──

import type { Plan as LegacyPlan, Task, RiskLevel } from "./types.js";
import { randomUUID } from "crypto";

type LegacyPlanResult = Omit<LegacyPlan, "description" | "version" | "updatedAt" | "dependencies" | "estimatedEffort"> & {
  description: string; version: number; updatedAt: Date; dependencies: never[]; estimatedEffort: number;
};

export class PlanGenerator {
  async generatePlan(goal: string): Promise<LegacyPlanResult> {
    const gLower = goal.toLowerCase();

    const tasks: Task[] = [];
    let estimatedRisk: RiskLevel = "medium";

    if (gLower.includes("delete") || gLower.includes("remove")) {
      estimatedRisk = "high";
      tasks.push(
        { id: "T1", description: "Identify targets", type: "analysis", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: [], successCriteria: [] },
        { id: "T2", description: "Backup affected files", type: "review", effort: 2, riskLevel: "medium", requiresApproval: true, dependencies: ["T1"], successCriteria: [] },
        { id: "T3", description: "Perform deletion", type: "delete", effort: 1, riskLevel: "high", requiresApproval: true, dependencies: ["T2"], successCriteria: [] }
      );
    } else if (gLower.includes("fix") || gLower.includes("bug") || gLower.includes("error")) {
      tasks.push(
        { id: "T1", description: "Reproduce the bug", type: "analysis", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: [], successCriteria: [] },
        { id: "T2", description: "Identify root cause", type: "analysis", effort: 2, riskLevel: "low", requiresApproval: false, dependencies: ["T1"], successCriteria: [] },
        { id: "T3", description: "Implement fix", type: "modify", effort: 2, riskLevel: "medium", requiresApproval: false, dependencies: ["T2"], successCriteria: [] },
        { id: "T4", description: "Write regression test", type: "test", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: ["T3"], successCriteria: [] }
      );
    } else if (gLower.includes("refactor") || gLower.includes("clean") || gLower.includes("restructure")) {
      tasks.push(
        { id: "T1", description: "Audit current structure", type: "analysis", effort: 2, riskLevel: "low", requiresApproval: false, dependencies: [], successCriteria: [] },
        { id: "T2", description: "Plan refactoring approach", type: "analysis", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: ["T1"], successCriteria: [] },
        { id: "T3", description: "Perform refactoring", type: "refactor", effort: 4, riskLevel: "medium", requiresApproval: false, dependencies: ["T2"], successCriteria: [] },
        { id: "T4", description: "Verify tests pass", type: "test", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: ["T3"], successCriteria: [] }
      );
    } else {
      // Default: feature implementation
      tasks.push(
        { id: "T1", description: "Analyze requirements", type: "analysis", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: [], successCriteria: [] },
        { id: "T2", description: "Design solution", type: "analysis", effort: 2, riskLevel: "low", requiresApproval: false, dependencies: ["T1"], successCriteria: [] },
        { id: "T3", description: "Implement feature", type: "create", effort: 4, riskLevel: "medium", requiresApproval: false, dependencies: ["T2"], successCriteria: [] },
        { id: "T4", description: "Write unit tests", type: "test", effort: 2, riskLevel: "low", requiresApproval: false, dependencies: ["T3"], successCriteria: [] },
        { id: "T5", description: "Review and refine", type: "review", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: ["T4"], successCriteria: [] }
      );
    }

    const totalEffort = tasks.reduce((s, t) => s + t.effort, 0);

    return {
      id: randomUUID(),
      goal,
      description: `Automated plan for: ${goal}`,
      status: "draft",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      tasks,
      dependencies: [],
      estimatedEffort: totalEffort,
      estimatedRisk,
    } as unknown as LegacyPlanResult;
  }
}

