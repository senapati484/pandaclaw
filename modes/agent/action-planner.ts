import { randomUUID } from "crypto";
import type { MutationPlan, MutationProposal, MutationType } from "./types";
import { ModelSelector } from "./model-selector";

export class ActionPlanner {
  /**
   * Create a mutation plan for a complex task
   * Returns steps needed to achieve the goal
   */
  async createMutationPlan(
    goal: string,
    context: {
      codebasePath: string;
      projectStructure?: string[];
      existingFiles?: string[];
    },
    modelSelector?: ModelSelector
  ): Promise<MutationPlan> {
    let steps: MutationProposal[] = [];
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
      steps = await this.generateStepsWithLLM(goal, context, modelSelector);
    } else {
      steps = this.breakDownGoalOffline(goal, context);
    }

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

  private async generateStepsWithLLM(
    goal: string,
    context: any,
    modelSelector: ModelSelector
  ): Promise<MutationProposal[]> {
    const prompt = `You are the planning core of PandaClaw. Your job is to break down a project goal into a list of file and shell mutations.
Goal: "${goal}"
Codebase Path: "${context.codebasePath}"
Project Structure (directories):
${JSON.stringify(context.projectStructure || [], null, 2)}
Existing Files:
${JSON.stringify(context.existingFiles || [], null, 2)}

Available mutation types:
- "file_create": Creates a new file at a relative path (provide "content" as the file content string).
- "file_modify": Modifies an existing file at a relative path (provide "content" as the full new content of the file).
- "file_delete": Deletes a file.
- "folder_create": Creates a new directory.
- "folder_delete": Deletes a directory.
- "shell_command": Executes a command in the shell (provide "command" as the command string).

Respond ONLY with a JSON array of mutation steps. Do not include markdown code block formatting (like \`\`\`json). The response must be a valid JSON array matching the TypeScript interface below:
interface MutationProposal {
  type: "file_create" | "file_modify" | "file_delete" | "folder_create" | "folder_delete" | "shell_command";
  path: string; // relative path from codebase root, e.g. "testing.txt" or "src/app.ts" (for shell_command, path can be codebase root)
  content?: string; // required for file_create / file_modify
  command?: string; // required for shell_command
  rationale: string; // brief explanation of why this mutation is needed
  estimatedRisk: "low" | "medium" | "high";
  requiresApproval: boolean; // true for high risk or critical actions
}

Example response:
[
  {
    "type": "file_create",
    "path": "testing.txt",
    "content": "Hello World from PandaClaw!",
    "rationale": "Create the requested testing.txt file with custom text",
    "estimatedRisk": "low",
    "requiresApproval": false
  }
]`;

    try {
      const responseText = await modelSelector.generateText("planning", prompt);
      
      // Clean up markdown block wraps if LLM included them
      let cleaned = responseText.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(json)?/, "").replace(/```$/, "").trim();
      }

      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => ({
          id: item.id || randomUUID(),
          type: item.type,
          path: item.path,
          content: item.content,
          command: item.command,
          rationale: item.rationale || "Generated via LLM",
          estimatedRisk: item.estimatedRisk || "low",
          requiresApproval: item.requiresApproval ?? false,
        }));
      }
    } catch (e) {
      console.error("Failed to generate plan steps using LLM, falling back to offline planner:", e);
    }

    return this.breakDownGoalOffline(goal, context);
  }

  /**
   * Break down a goal into actionable mutation steps
   */
  private breakDownGoalOffline(
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
    // Detect explicit filename with extension first — takes priority over test heuristic
    const hasExplicitExtension = /\b[\w-]+\.\w{1,6}\b/.test(goal);

    // Check test creation: must have standalone "test" word but NOT an explicit file extension
    if (
      !hasExplicitExtension &&
      goalLower.includes("create") &&
      /\btest\b/i.test(goal) &&
      !goalLower.match(/\.test\./)
    ) {
      steps.push(...this.planTestCreation(goal, context));
    } else if (
      goalLower.includes("create") ||
      goalLower.includes("make") ||
      goalLower.includes("add")
    ) {
      // Check if there's a filename hint (any word with extension OR named/called X)
      const hasFilenameHint =
        /\.\w{1,6}\b/.test(goal) || // has extension like .txt, .ts, .json
        /(?:called|named)\s+\w+/i.test(goal) || // "called X" or "named X"
        goalLower.includes("file") ||
        goalLower.includes("component") ||
        goalLower.includes("module");

      if (hasFilenameHint) {
        steps.push(...this.planFileCreation(goal, context));
      } else if (goalLower.includes("function")) {
        steps.push(...this.planFunctionAddition(goal, context));
      } else {
        steps.push(...this.planFileCreation(goal, context));
      }
    } else if (goalLower.includes("refactor") || goalLower.includes("update")) {
      steps.push(...this.planRefactoring(goal, context));
    } else if (goalLower.includes("delete") || goalLower.includes("remove")) {
      steps.push(...this.planDeletion(goal, context));
    } else {
      // Generic plan: create a notes file about the goal rather than using code_analysis
      steps.push({
        id: randomUUID(),
        type: "file_create" as MutationType,
        path: `panda-notes-${Date.now()}.txt`,
        content: `Goal: ${goal}\n\nThis task requires human guidance. PandaClaw could not auto-plan it.\n`,
        rationale: `Could not automatically plan: "${goal}". Created a notes file instead.`,
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
    // Extract full filename (with extension) from goal using multiple strategies
    let fileName = "newfile.ts";

    // Strategy 1: Find a word with a file extension (e.g. testing.txt, hello.ts)
    const extMatch = goal.match(/\b([\w-]+\.\w{1,6})\b/i);
    if (extMatch && extMatch[1]) {
      fileName = extMatch[1];
    } else {
      // Strategy 2: "called X" or "named X"
      const calledMatch = goal.match(/(?:called|named)\s+([\w.-]+)/i);
      if (calledMatch && calledMatch[1]) {
        fileName = calledMatch[1].includes(".") ? calledMatch[1] : `${calledMatch[1]}.ts`;
      } else {
        // Strategy 3: extract the noun after create/make/add ... file/component
        const createMatch = goal.match(
          /(?:create|make|add)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?(?:called\s+|named\s+)?([\w.-]+)/i
        );
        if (createMatch && createMatch[1] && createMatch[1].toLowerCase() !== "file") {
          const name = createMatch[1];
          fileName = name.includes(".") ? name : `${name}.ts`;
        }
      }
    }

    // Determine path: if it has a non-ts extension, place at root; otherwise put in src/
    const hasNonTsExtension = /\.(?!ts$|tsx$)\w{1,6}$/i.test(fileName);
    const filePath = hasNonTsExtension ? fileName : `src/${fileName}`;

    // Generate appropriate starter content based on extension
    const ext = fileName.split(".").pop()?.toLowerCase();
    let content: string;
    if (ext === "txt" || ext === "md") {
      content = `Created by PandaClaw 🐼\n`;
    } else if (ext === "json") {
      content = `{}\n`;
    } else {
      const baseName = fileName.replace(/\.\w+$/, "");
      content = `// ${baseName}\n\n// TODO: Implement ${baseName}\n`;
    }

    return [
      {
        id: randomUUID(),
        type: "file_create",
        path: filePath,
        content,
        rationale: `Create ${fileName} as requested`,
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
      if (!step) continue;

      // File creates should come before modifies of the same file
      if (step.type === "file_modify") {
        for (let j = 0; j < i; j++) {
          const prevStep = steps[j];
          if (prevStep && prevStep.type === "file_create" && prevStep.path === step.path) {
            dependencies.push(`Step ${j + 1} must complete before Step ${i + 1}`);
          }
        }
      }

      // Analysis (code_analysis action type) should come before modifications
      if (
        (step.type === "file_modify" || step.type === "file_create") &&
        i > 0
      ) {
        // code_analysis is an ActionType (not MutationType) so we cast to check
        const prevStep = steps[i - 1];
        if (prevStep && (prevStep as any).type === "code_analysis") {
          dependencies.push(`Step ${i} must complete after Step ${i - 1}`);
        }
      }
    }

    return dependencies;
  }
}
