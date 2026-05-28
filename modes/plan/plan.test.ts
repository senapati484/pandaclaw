import { test, expect } from "bun:test";
import { PlanGenerator } from "./plan-generator";
import { PlanValidator } from "./plan-validator";
import { PlanOptimizer } from "./plan-optimizer";
import type { Task } from "./types";

test("PlanGenerator decomposes goals based on keywords", async () => {
  const generator = new PlanGenerator();

  const featurePlan = await generator.generatePlan("Implement user login authentication feature");
  expect(featurePlan.tasks.length).toBe(5);
  expect(featurePlan.estimatedRisk).toBe("medium");

  const refactorPlan = await generator.generatePlan("Refactor database modules and clean code");
  expect(refactorPlan.tasks.length).toBe(4);

  const bugfixPlan = await generator.generatePlan("Fix null pointer error in auth.ts");
  expect(bugfixPlan.tasks.length).toBe(4);

  const deletePlan = await generator.generatePlan("Delete old temp.ts file");
  expect(deletePlan.tasks.length).toBe(3);
  expect(deletePlan.estimatedRisk).toBe("high");
});

test("PlanValidator detects dependency issues", () => {
  const validator = new PlanValidator();

  // Test Cycle detection
  const cyclicTasks: Task[] = [
    { id: "T1", description: "Task 1", type: "create", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: ["T2"], successCriteria: [] },
    { id: "T2", description: "Task 2", type: "create", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: ["T1"], successCriteria: [] }
  ];
  const cycleRes = validator.validate(cyclicTasks);
  expect(cycleRes.valid).toBe(false);
  expect(cycleRes.issues[0]).toContain("Circular dependency cycle");

  // Test Missing Dependency Check
  const missingTasks: Task[] = [
    { id: "T1", description: "Task 1", type: "create", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: ["T3"], successCriteria: [] }
  ];
  const missingRes = validator.validate(missingTasks);
  expect(missingRes.valid).toBe(false);
  expect(missingRes.issues[0]).toContain("non-existent dependency");
});

test("PlanOptimizer computes topological groups and critical path", () => {
  const optimizer = new PlanOptimizer();

  const tasks: Task[] = [
    { id: "T1", description: "Task 1", type: "create", effort: 2, riskLevel: "low", requiresApproval: false, dependencies: [], successCriteria: [] },
    { id: "T2", description: "Task 2", type: "create", effort: 3, riskLevel: "low", requiresApproval: false, dependencies: [], successCriteria: [] },
    { id: "T3", description: "Task 3", type: "create", effort: 1, riskLevel: "low", requiresApproval: false, dependencies: ["T1"], successCriteria: [] },
    { id: "T4", description: "Task 4", type: "create", effort: 4, riskLevel: "low", requiresApproval: false, dependencies: ["T2", "T3"], successCriteria: [] }
  ];

  const optRes = optimizer.optimize(tasks);
  expect(optRes.originalEffort).toBe(10);
  
  // Parallel Levels: Level 1 has T1 and T2; Level 2 has T3; Level 3 has T4
  expect(optRes.parallelGroups.length).toBe(3);
  expect(optRes.parallelGroups[0]).toContain("T1");
  expect(optRes.parallelGroups[0]).toContain("T2");
  expect(optRes.parallelGroups[1]).toContain("T3");
  expect(optRes.parallelGroups[2]).toContain("T4");

  // Critical path by effort hours:
  // Path T1 -> T3 -> T4 = 2 + 1 + 4 = 7 hours
  // Path T2 -> T4 = 3 + 4 = 7 hours
  // Either path is a critical path. Let's make sure it equals 7.
  expect(optRes.optimizedEffort).toBe(7);
  expect(optRes.criticalPath).toContain("T4");
});
