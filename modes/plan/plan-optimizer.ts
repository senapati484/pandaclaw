import type { Task, OptimizationResult } from "./types";

export class PlanOptimizer {
  /**
   * Optimize tasks topological execution path, grouping parallel levels
   * and calculating the critical path (longest sequential chain by effort hours).
   */
  optimize(tasks: Task[]): OptimizationResult {
    const originalEffort = tasks.reduce((sum, t) => sum + t.effort, 0);

    // 1. Group Tasks into Parallel Topological Levels
    const parallelGroups: string[][] = [];
    let remainingTasks = [...tasks];
    const completedIds = new Set<string>();

    while (remainingTasks.length > 0) {
      const level: string[] = [];
      const nextRemaining: Task[] = [];

      for (const t of remainingTasks) {
        const allDepsMet = t.dependencies.every((d) => completedIds.has(d));
        if (allDepsMet) {
          level.push(t.id);
        } else {
          nextRemaining.push(t);
        }
      }

      if (level.length === 0) {
        // Safe exit in case of broken references
        level.push(...remainingTasks.map((t) => t.id));
        nextRemaining.length = 0;
      }

      parallelGroups.push(level);
      level.forEach((id) => completedIds.add(id));
      remainingTasks = nextRemaining;
    }

    // 2. Critical Path calculation (Longest Path by effort hours)
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const memoPath = new Map<string, { effort: number; path: string[] }>();

    function getLongestPath(id: string): { effort: number; path: string[] } {
      if (memoPath.has(id)) return memoPath.get(id)!;

      const task = taskMap.get(id);
      if (!task) return { effort: 0, path: [] };

      let maxDepEffort = 0;
      let maxDepPath: string[] = [];

      for (const depId of task.dependencies) {
        const depResult = getLongestPath(depId);
        if (depResult.effort > maxDepEffort) {
          maxDepEffort = depResult.effort;
          maxDepPath = depResult.path;
        }
      }

      const result = {
        effort: task.effort + maxDepEffort,
        path: [...maxDepPath, task.id]
      };

      memoPath.set(id, result);
      return result;
    }

    let criticalPathResult = { effort: 0, path: [] as string[] };
    for (const t of tasks) {
      const pathResult = getLongestPath(t.id);
      if (pathResult.effort > criticalPathResult.effort) {
        criticalPathResult = pathResult;
      }
    }

    // Optimized effort corresponds to the critical path length in parallel execution
    const optimizedEffort = criticalPathResult.effort;

    return {
      originalEffort,
      optimizedEffort,
      parallelGroups,
      criticalPath: criticalPathResult.path
    };
  }
}
