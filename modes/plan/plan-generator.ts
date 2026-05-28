import { randomUUID } from "crypto";
import type { Task, Dependency, Plan, RiskLevel, TaskType } from "./types";
import { ModelSelector } from "./model-selector";

export class PlanGenerator {
  /**
   * Decompose a goal into structured tasks and dependencies.
   */
  async generatePlan(goal: string, context?: { codebasePath: string }, modelSelector?: ModelSelector): Promise<Plan> {
    const goalLower = goal.toLowerCase();
    let tasks: Task[] = [];
    let description = `Strategic plan to achieve: ${goal}`;
    let useLLM = false;

    if (modelSelector) {
      try {
        const config = await modelSelector.selectModel("planning");
        if (config.provider === "groq" || config.provider === "openrouter") {
          useLLM = true;
        }
      } catch (e) {
        // Fall back
      }
    }

    if (useLLM && modelSelector) {
      tasks = await this.generatePlanWithLLM(goal, context, modelSelector);
    } else {
      tasks = this.generatePlanOffline(goal);
    }

    // Map dependencies
    const dependencies: Dependency[] = [];
    for (const t of tasks) {
      if (t.dependencies.length > 0) {
        dependencies.push({
          taskId: t.id,
          dependsOn: t.dependencies,
          type: "blocking"
        });
      }
    }

    // Calculate effort and risk
    const estimatedEffort = tasks.reduce((sum, t) => sum + t.effort, 0);
    let estimatedRisk: RiskLevel = "low";
    for (const t of tasks) {
      if (t.riskLevel === "high") estimatedRisk = "high";
      if (t.riskLevel === "medium" && estimatedRisk === "low") estimatedRisk = "medium";
    }

    return {
      id: randomUUID(),
      goal,
      description,
      status: "draft",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      tasks,
      dependencies,
      estimatedEffort,
      estimatedRisk
    };
  }

  private generatePlanOffline(goal: string): Task[] {
    const goalLower = goal.toLowerCase();
    if (goalLower.includes("create") || goalLower.includes("implement") || goalLower.includes("add") || goalLower.includes("build")) {
      return this.planFeatureImplementation(goal);
    } else if (goalLower.includes("refactor") || goalLower.includes("update") || goalLower.includes("clean")) {
      return this.planRefactoring(goal);
    } else if (goalLower.includes("fix") || goalLower.includes("resolve") || goalLower.includes("bug") || goalLower.includes("error")) {
      return this.planBugFix(goal);
    } else if (goalLower.includes("delete") || goalLower.includes("remove")) {
      return this.planDeletion(goal);
    } else {
      return this.planDefault(goal);
    }
  }

  private async generatePlanWithLLM(
    goal: string,
    context: any,
    modelSelector: ModelSelector
  ): Promise<Task[]> {
    const prompt = `You are the strategic planner of PandaClaw. Your job is to break down a project goal into high-level tasks.
Goal: "${goal}"

Available task types: "analysis" | "create" | "modify" | "delete" | "test" | "review" | "refactor".
Available risk levels: "low" | "medium" | "high".

Respond ONLY with a JSON array of tasks. Do not include markdown code block formatting. The response must be a valid JSON array matching the TypeScript interface below:
interface Task {
  id: string; // unique short ID like "T1", "T2", "T3"
  description: string; // clear description of the task
  type: "analysis" | "create" | "modify" | "delete" | "test" | "review" | "refactor";
  effort: number; // estimated effort in hours
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  dependencies: string[]; // list of task IDs that this task depends on (e.g. ["T1"])
  successCriteria: string[]; // list of criteria to verify if the task is complete
}

Example response:
[
  {
    "id": "T1",
    "description": "Create the test file with the requested path and content",
    "type": "create",
    "effort": 1,
    "riskLevel": "low",
    "requiresApproval": false,
    "dependencies": [],
    "successCriteria": ["testing.txt exists at root with the correct text"]
  }
]`;

    try {
      const responseText = await modelSelector.generateText("planning", prompt);
      
      let cleaned = responseText.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(json)?/, "").replace(/```$/, "").trim();
      }

      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      console.error("Failed to generate plan using LLM, falling back to offline planner:", e);
    }

    return this.generatePlanOffline(goal);
  }

  private planFeatureImplementation(goal: string): Task[] {
    return [
      {
        id: "T1",
        description: "Analyze existing modules and structure for feature integration",
        type: "analysis",
        effort: 1,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: [],
        successCriteria: ["Identified files and interfaces requiring changes"]
      },
      {
        id: "T2",
        description: "Create new file or module skeleton",
        type: "create",
        effort: 2,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: ["T1"],
        successCriteria: ["File template successfully created"]
      },
      {
        id: "T3",
        description: "Implement core logic and integrate with other components",
        type: "modify",
        effort: 3,
        riskLevel: "medium",
        requiresApproval: false,
        dependencies: ["T2"],
        successCriteria: ["Functional implementation matches requirements"]
      },
      {
        id: "T4",
        description: "Write unit tests for the implemented feature",
        type: "test",
        effort: 2,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: ["T2"],
        successCriteria: ["Tests verify success and edge cases successfully"]
      },
      {
        id: "T5",
        description: "Code review and code style validation",
        type: "review",
        effort: 1,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: ["T3", "T4"],
        successCriteria: ["Verification of lint standards and structural design"]
      }
    ];
  }

  private planRefactoring(goal: string): Task[] {
    return [
      {
        id: "T1",
        description: "Locate code smell, duplicate definitions, or complexity bottlenecks",
        type: "analysis",
        effort: 1,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: [],
        successCriteria: ["Pinpointed blocks suitable for refactoring"]
      },
      {
        id: "T2",
        description: "Perform code refactoring updates on target files",
        type: "refactor",
        effort: 4,
        riskLevel: "medium",
        requiresApproval: false,
        dependencies: ["T1"],
        successCriteria: ["Refactored code works correctly with cleaner design"]
      },
      {
        id: "T3",
        description: "Verify that existing test suites continue to pass",
        type: "test",
        effort: 2,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: ["T2"],
        successCriteria: ["Zero regression issues found in test runs"]
      },
      {
        id: "T4",
        description: "Verify structural alignment and documentation consistency",
        type: "review",
        effort: 1,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: ["T2"],
        successCriteria: ["API documentation and comments are updated"]
      }
    ];
  }

  private planBugFix(goal: string): Task[] {
    return [
      {
        id: "T1",
        description: "Reproduce error, inspect stack traces, and analyze cause",
        type: "analysis",
        effort: 1,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: [],
        successCriteria: ["Located root cause of the error or bug"]
      },
      {
        id: "T2",
        description: "Apply bug fix modification in the source files",
        type: "modify",
        effort: 2,
        riskLevel: "medium",
        requiresApproval: false,
        dependencies: ["T1"],
        successCriteria: ["Error is no longer reproducible"]
      },
      {
        id: "T3",
        description: "Create a regression test to prevent recurrence",
        type: "test",
        effort: 1,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: ["T2"],
        successCriteria: ["Test asserts successful code correction path"]
      },
      {
        id: "T4",
        description: "Review fix, safety implications, and confirm",
        type: "review",
        effort: 1,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: ["T2", "T3"],
        successCriteria: ["Fix conforms to existing design principles"]
      }
    ];
  }

  private planDeletion(goal: string): Task[] {
    return [
      {
        id: "T1",
        description: "Verify module usage, search codebase for importers or callers",
        type: "analysis",
        effort: 1,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: [],
        successCriteria: ["Catalogued all references to the resource"]
      },
      {
        id: "T2",
        description: "Delete the target file or directory",
        type: "delete",
        effort: 1,
        riskLevel: "high",
        requiresApproval: true,
        dependencies: ["T1"],
        successCriteria: ["Resource has been removed from workspace"]
      },
      {
        id: "T3",
        description: "Remove leftover imports, test suites, or dead configurations",
        type: "modify",
        effort: 2,
        riskLevel: "medium",
        requiresApproval: false,
        dependencies: ["T2"],
        successCriteria: ["Clean compile with no unresolved imports"]
      }
    ];
  }

  private planDefault(goal: string): Task[] {
    return [
      {
        id: "T1",
        description: `Analyze codebase context for goal: ${goal}`,
        type: "analysis",
        effort: 1,
        riskLevel: "low",
        requiresApproval: false,
        dependencies: [],
        successCriteria: ["Identified context and constraints"]
      },
      {
        id: "T2",
        description: `Implement required task modifications`,
        type: "modify",
        effort: 3,
        riskLevel: "medium",
        requiresApproval: false,
        dependencies: ["T1"],
        successCriteria: ["Work successfully completed"]
      }
    ];
  }
}
