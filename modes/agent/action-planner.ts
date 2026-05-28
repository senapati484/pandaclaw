import { randomUUID } from "crypto";
import type { MutationPlan, MutationProposal, MutationType } from "./types";

export class ActionPlanner {
  /**
   * Create a mutation plan for a complex task
   * Returns steps needed to achieve the goal
   */
  createMutationPlan(
    goal: string,
    context: {
      codebasePath: string;
      projectStructure?: string[];
      existingFiles?: string[];
    }
  ): MutationPlan {
    const steps = this.breakDownGoal(goal, context);
    const dependencies = this.analyzeDependencies(steps);

    // Estimate overall risk
    let overallRisk: "low" | "medium" | "high" = "low";
    let requiresApproval = false;

    for (const step of steps) {
      if (step.estimatedRisk === "high") overallRisk = "high";
      if (step.estimatedRisk === "medium" && overallRisk === "low")
        overallRisk = "medium";
      if (step.requiresApproval) requiresApproval = true;
    }

    return {
      steps,
      estimatedRisk: overallRisk,
      requiresApproval,
      totalMutations: steps.length,
      description: goal,
      dependencies,
    };
  }

  /**
   * Break down a goal into actionable mutation steps
   */
  private breakDownGoal(
    goal: string,
    context: {
      codebasePath: string;
      projectStructure?: string[];
      existingFiles?: string[];
    }
  ): MutationProposal[] {
    const steps: MutationProposal[] = [];
    const goalLower = goal.toLowerCase();

    // Pattern matching for common tasks
    if (
      goalLower.includes("create") &&
      goalLower.includes("test")
    ) {
      steps.push(...this.planTestCreation(goal, context));
    } else if (
      goalLower.includes("create") &&
      (goalLower.includes("file") || goalLower.includes("component"))
    ) {
      steps.push(...this.planFileCreation(goal, context));
    } else if (goalLower.includes("add") && goalLower.includes("function")) {
      steps.push(...this.planFunctionAddition(goal, context));
    } else if (goalLower.includes("refactor") || goalLower.includes("update")) {
      steps.push(...this.planRefactoring(goal, context));
    } else if (goalLower.includes("delete") || goalLower.includes("remove")) {
      steps.push(...this.planDeletion(goal, context));
    } else {
      // Generic plan
      steps.push({
        id: randomUUID(),
        type: "code_analysis" as MutationType,
        path: context.codebasePath,
        rationale: `Analyze codebase to understand how to: ${goal}`,
        estimatedRisk: "low",
        requiresApproval: false,
      });
    }

    return steps;
  }

  private planTestCreation(
    goal: string,
    context: any
  ): MutationProposal[] {
    // Extract filename from goal
    const match = goal.match(/(?:for|of)\s+(\w+)/i);
    const targetFile = match ? match[1] : "feature";
    const testPath = `tests/${targetFile}.test.ts`;

    return [
      {
        id: randomUUID(),
        type: "file_create",
        path: testPath,
        rationale: `Create test file for ${targetFile}`,
        estimatedRisk: "low",
        requiresApproval: false,
      },
    ];
  }

  private planFileCreation(
    goal: string,
    context: any
  ): MutationProposal[] {
    // Extract filename from goal
    const match = goal.match(/create\s+(?:a\s+)?(?:file\s+)?(?:named\s+)?(\w+)/i);
    const fileName = match ? match[1] : "newfile";
    const filePath = `src/${fileName}.ts`;

    return [
      {
        id: randomUUID(),
        type: "file_create",
        path: filePath,
        content: `// ${fileName}\n\n// TODO: Implement ${fileName}\n`,
        rationale: `Create ${fileName} file`,
        estimatedRisk: "low",
        requiresApproval: false,
      },
    ];
  }

  private planFunctionAddition(
    goal: string,
    context: any
  ): MutationProposal[] {
    const match = goal.match(/(?:add|create)\s+(?:a\s+)?function\s+(?:named\s+)?(\w+)/i);
    const funcName = match ? match[1] : "newFunction";

    return [
      {
        id: randomUUID(),
        type: "code_analysis" as MutationType,
        path: context.codebasePath,
        rationale: `Find best file to add ${funcName} function`,
        estimatedRisk: "low",
        requiresApproval: false,
      },
      {
        id: randomUUID(),
        type: "file_modify",
        path: "src/utils.ts", // Placeholder
        rationale: `Add ${funcName} function`,
        estimatedRisk: "medium",
        requiresApproval: false,
      },
    ];
  }

  private planRefactoring(goal: string, context: any): MutationProposal[] {
    return [
      {
        id: randomUUID(),
        type: "code_analysis" as MutationType,
        path: context.codebasePath,
        rationale: `Analyze code for refactoring: ${goal}`,
        estimatedRisk: "low",
        requiresApproval: false,
      },
      {
        id: randomUUID(),
        type: "file_modify",
        path: "src/main.ts", // Placeholder
        rationale: `Apply refactoring: ${goal}`,
        estimatedRisk: "medium",
        requiresApproval: false,
      },
    ];
  }

  private planDeletion(goal: string, context: any): MutationProposal[] {
    const match = goal.match(/(?:delete|remove)\s+(?:the\s+)?(?:file\s+)?(\w+)/i);
    const targetFile = match ? match[1] : "file";

    return [
      {
        id: randomUUID(),
        type: "file_delete",
        path: `src/${targetFile}.ts`,
        rationale: `Delete ${targetFile} file`,
        estimatedRisk: "high",
        requiresApproval: true,
      },
    ];
  }

  /**
   * Analyze dependencies between steps
   * Returns order in which steps should be executed
   */
  private analyzeDependencies(steps: MutationProposal[]): string[] {
    const dependencies: string[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // File creates should come before modifies of the same file
      if (step.type === "file_modify") {
        for (let j = 0; j < i; j++) {
          const prevStep = steps[j];
          if (prevStep.type === "file_create" && prevStep.path === step.path) {
            dependencies.push(`Step ${j + 1} must complete before Step ${i + 1}`);
          }
        }
      }

      // Analysis should come before modifications
      if (
        (step.type === "file_modify" || step.type === "file_create") &&
        i > 0
      ) {
        const prevStep = steps[i - 1];
        if (prevStep.type === "code_analysis") {
          dependencies.push(
            `Step ${i} must complete after Step ${i - 1}`
          );
        }
      }
    }

    return dependencies;
  }
}
