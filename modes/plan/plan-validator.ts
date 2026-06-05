import type { Task, ValidationResult } from "./types";
import { SessionMemoryManager } from "../agent/session-memory.js";

export class PlanValidator {
  /**
   * Validate a plan, checking for cycle dependencies, missing dependencies, and constraints.
   */
  validate(tasks: Task[], memory?: SessionMemoryManager): ValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    // 1. Cycle Detection (DFS)
    const visited = new Set<string>();
    const recStack = new Set<string>();

    function hasCycle(id: string): boolean {
      if (recStack.has(id)) return true;
      if (visited.has(id)) return false;

      visited.add(id);
      recStack.add(id);

      const task = taskMap.get(id);
      if (task) {
        for (const depId of task.dependencies) {
          if (hasCycle(depId)) return true;
        }
      }

      recStack.delete(id);
      return false;
    }

    for (const task of tasks) {
      if (hasCycle(task.id)) {
        issues.push(`Circular dependency cycle detected involving task ${task.id}`);
        break;
      }
    }

    // 2. Missing Dependency Targets Check
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!taskMap.has(depId)) {
          issues.push(`Task ${task.id} has non-existent dependency: ${depId}`);
        }
      }
    }

    // 3. Constraint Compliance Checks (e.g. from SessionMemory constraints)
    if (memory) {
      const constraints = memory.getConstraints() as any;
      // We can query constraints and log violations here if applicable
      // As a local pattern check, if a task modifies package.json but doesn't require approval, issue warning
      for (const task of tasks) {
        if (task.description.toLowerCase().includes("package.json") && !task.requiresApproval) {
          warnings.push(`Task ${task.id} modifies package.json but requiresApproval is false.`);
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      warnings
    };
  }
}
