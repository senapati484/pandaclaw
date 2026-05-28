import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ValidationResult, ReflectionResult, ActionLog, ExecutionResult } from "./types";

export class ReflectionEngine {
  private codebasePath: string;
  private validationHistory: Map<string, ValidationResult> = new Map();

  constructor(codebasePath: string) {
    this.codebasePath = codebasePath;
  }

  /**
   * Validate that an executed mutation matches the intended outcome
   */
  async validateMutation(action: ActionLog, executionResult: ExecutionResult): Promise<ValidationResult> {
    const cacheKey = `${action.id}-${executionResult.executedAt.getTime()}`;

    // Return cached validation if available
    if (this.validationHistory.has(cacheKey)) {
      return this.validationHistory.get(cacheKey)!;
    }

    let result: ValidationResult = {
      valid: false,
      matches_intent: false,
      issues: [],
      suggestions: [],
    };

    try {
      if (action.type === "file_create") {
        result = this.validateFileCreate(action, executionResult);
      } else if (action.type === "file_modify") {
        result = this.validateFileModify(action, executionResult);
      } else if (action.type === "file_delete") {
        result = this.validateFileDelete(action, executionResult);
      } else if (action.type === "shell_command") {
        result = this.validateShellCommand(action, executionResult);
      } else {
        result.valid = true;
        result.matches_intent = !executionResult.error;
      }
    } catch (error) {
      result.issues.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.validationHistory.set(cacheKey, result);
    return result;
  }

  /**
   * Reflect on an action and suggest next steps
   */
  async reflect(
    action: ActionLog,
    executionResult: ExecutionResult,
    sessionGoal: string
  ): Promise<ReflectionResult> {
    const validation = await this.validateMutation(action, executionResult);

    if (!validation.valid) {
      return {
        succeeded: false,
        observation: `Mutation failed: ${validation.issues.join(", ")}`,
        suggestedNextStep: validation.suggestions[0] || "Review error and retry",
        shouldRetry: this.isRetryableError(validation.issues),
        confidence: 0.3,
      };
    }

    if (!validation.matches_intent) {
      return {
        succeeded: false,
        observation: `Mutation executed but didn't match intent. Action: ${action.type} on ${action.path}`,
        suggestedNextStep: "Review and adjust approach",
        shouldRetry: false,
        confidence: 0.4,
      };
    }

    return {
      succeeded: true,
      observation: `Successfully ${action.type} on ${action.path}`,
      suggestedNextStep: this.suggestNextStep(sessionGoal, action),
      shouldRetry: false,
      confidence: 0.9,
    };
  }

  /**
   * Analyze patterns in failed actions
   */
  analyzeFailurePattern(failures: ActionLog[]): {
    commonIssue: string;
    frequency: number;
    suggestedFix: string;
  } | null {
    if (failures.length === 0) return null;

    const issues: Map<string, number> = new Map();

    for (const failure of failures) {
      const issue = failure.details.error || "Unknown error";
      issues.set(issue, (issues.get(issue) || 0) + 1);
    }

    // Find most common issue
    let mostCommon = { issue: "", count: 0 };
    issues.forEach((count, issue) => {
      if (count > mostCommon.count) {
        mostCommon = { issue, count };
      }
    });

    return {
      commonIssue: mostCommon.issue,
      frequency: mostCommon.count,
      suggestedFix: this.suggestedFix(mostCommon.issue),
    };
  }

  /**
   * Check if error is likely retryable
   */
  private isRetryableError(issues: string[]): boolean {
    const retryablePatterns = [
      "timeout",
      "ECONNREFUSED",
      "EAGAIN",
      "temporarily unavailable",
      "rate limit",
    ];

    return issues.some((issue) =>
      retryablePatterns.some((pattern) => issue.toLowerCase().includes(pattern.toLowerCase()))
    );
  }

  private validateFileCreate(action: ActionLog, result: ExecutionResult): ValidationResult {
    const fullPath = join(this.codebasePath, action.path);

    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check if file exists
    if (!existsSync(fullPath)) {
      issues.push("File was not created");
      suggestions.push("Check permissions and retry");
      return {
        valid: false,
        matches_intent: false,
        issues,
        suggestions,
      };
    }

    // Check file has content
    try {
      const content = readFileSync(fullPath, "utf-8");
      if (!content && action.details.after) {
        issues.push("File created but is empty");
        suggestions.push("Verify content was written correctly");
      }
    } catch (error) {
      issues.push("Cannot read created file");
    }

    return {
      valid: issues.length === 0,
      matches_intent: issues.length === 0,
      issues,
      suggestions,
    };
  }

  private validateFileModify(action: ActionLog, result: ExecutionResult): ValidationResult {
    const fullPath = join(this.codebasePath, action.path);

    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check if file still exists
    if (!existsSync(fullPath)) {
      issues.push("File no longer exists");
      suggestions.push("Recreate the file or check previous steps");
      return {
        valid: false,
        matches_intent: false,
        issues,
        suggestions,
      };
    }

    // Check if modification was applied (simplified)
    if (!result.error && result.output) {
      return {
        valid: true,
        matches_intent: true,
        issues: [],
        suggestions: [],
      };
    }

    return {
      valid: !result.error,
      matches_intent: !!result.output,
      issues: result.error ? [result.error] : [],
      suggestions: [],
    };
  }

  private validateFileDelete(action: ActionLog, result: ExecutionResult): ValidationResult {
    const fullPath = join(this.codebasePath, action.path);

    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check if file is deleted
    if (existsSync(fullPath)) {
      issues.push("File still exists after deletion");
      suggestions.push("Check permissions and retry");
      return {
        valid: false,
        matches_intent: false,
        issues,
        suggestions,
      };
    }

    return {
      valid: true,
      matches_intent: true,
      issues: [],
      suggestions: [],
    };
  }

  private validateShellCommand(action: ActionLog, result: ExecutionResult): ValidationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];

    if (result.error) {
      issues.push(result.error);
      suggestions.push("Check command syntax and retry");
    }

    return {
      valid: !result.error,
      matches_intent: !!result.output,
      issues,
      suggestions,
    };
  }

  private suggestNextStep(goal: string, lastAction: ActionLog): string {
    const goalLower = goal.toLowerCase();

    if (
      goalLower.includes("test") &&
      (lastAction.type === "file_create" || lastAction.type === "file_modify")
    ) {
      return "Run tests to verify changes";
    }

    if (goalLower.includes("build") && lastAction.type === "file_modify") {
      return "Run build command to compile changes";
    }

    return "Continue with next planned step";
  }

  private suggestedFix(issue: string): string {
    const issueLower = issue.toLowerCase();

    if (issueLower.includes("permission")) {
      return "Check file permissions. May need sudo or different user.";
    }

    if (issueLower.includes("not found")) {
      return "Verify the path exists and is correct.";
    }

    if (issueLower.includes("timeout") || issueLower.includes("rate limit")) {
      return "Wait a moment and retry the operation.";
    }

    if (issueLower.includes("syntax")) {
      return "Review the code syntax and fix any errors.";
    }

    return "Check the error message and review the operation.";
  }

  /**
   * Clear validation history
   */
  clearHistory(): void {
    this.validationHistory.clear();
  }
}
