import { test, expect } from "bun:test";
import { ActionTracker } from "./action-tracker";
import { SessionMemoryManager } from "./session-memory";
import { CodebaseContextManager } from "./context-manager";
import { ActionPlanner } from "./action-planner";
import { ReflectionEngine } from "./reflection-engine";
import type { MutationProposal, ActionLog } from "./types";

test("ActionTracker: log and retrieve actions", () => {
  const tracker = new ActionTracker();

  const action = tracker.log({
    type: "file_create",
    path: "src/test.ts",
    details: {
      reasoning: "Create test file",
    },
  });

  expect(action.id).toBeTruthy();
  expect(action.type).toBe("file_create");
  expect(action.status).toBe("pending");
  expect(action.isMutation).toBe(true);

  const actions = tracker.getActions();
  expect(actions.length).toBe(1);
});

test("ActionTracker: approve and reject actions", () => {
  const tracker = new ActionTracker();

  const action = tracker.log({
    type: "file_create",
    path: "src/test.ts",
    details: {},
  });

  const approved = tracker.approveAction(action.id, "User approved");
  expect(approved).toBe(true);

  const updated = tracker.getAction(action.id);
  expect(updated?.status).toBe("approved");
  expect(updated?.userApproved).toBe(true);
});

test("ActionTracker: filter by type", () => {
  const tracker = new ActionTracker();

  tracker.log({
    type: "file_create",
    path: "src/file1.ts",
    details: {},
  });

  tracker.log({
    type: "file_modify",
    path: "src/file2.ts",
    details: {},
  });

  tracker.log({
    type: "code_analysis",
    path: "src",
    details: {},
  });

  const creates = tracker.getActionsByType("file_create");
  expect(creates.length).toBe(1);

  const mutations = tracker.getPendingMutations();
  expect(mutations.length).toBe(2); // create + modify are mutations
});

test("SessionMemoryManager: add and retrieve constraints", () => {
  const memory = new SessionMemoryManager();

  memory.addConstraint("forbidden_path", ".env", "Don't modify secrets", 0.9);
  memory.addConstraint(
    "naming_convention",
    "*.test.ts",
    "Test files end with .test.ts",
    0.8
  );

  const constraints = memory.getConstraints();
  expect(constraints.length).toBe(2);

  const forbidden = memory.getConstraints("forbidden_path");
  expect(forbidden.length).toBe(1);
  if (forbidden.length > 0) {
    expect(forbidden[0]!.value).toBe(".env");
  }
});

test("SessionMemoryManager: check constraint violations", () => {
  const memory = new SessionMemoryManager();

  memory.addConstraint("forbidden_path", ".env", "Don't modify secrets");
  memory.addConstraint("forbidden_path", "package.json", "Don't break deps");

  const violates1 = memory.violatesConstraints("src/.env.local");
  expect(violates1?.value).toBe(".env");

  const violates2 = memory.violatesConstraints("package.json");
  expect(violates2?.value).toBe("package.json");

  const noViolate = memory.violatesConstraints("src/main.ts");
  expect(noViolate).toBeNull();
});

test("SessionMemoryManager: error patterns", () => {
  const memory = new SessionMemoryManager();

  memory.recordError("ENOENT", "Create the file first");
  memory.recordError("ENOENT", "Create the file first");
  memory.recordError("EACCES", "Check permissions");

  const topErrors = memory.getTopErrorPatterns(5);
  expect(topErrors.length).toBe(2);
  if (topErrors.length > 0) {
    expect(topErrors[0]!.pattern).toBe("ENOENT");
    expect(topErrors[0]!.frequency).toBe(2);
  }
});

test("SessionMemoryManager: success patterns", () => {
  const memory = new SessionMemoryManager();

  memory.recordSuccessPattern(
    "Create test file",
    ["Analyze class", "Write test file", "Run tests"],
    "testing"
  );

  memory.recordSuccessPattern(
    "Refactor function",
    ["Create backup", "Update function", "Run tests"],
    "refactoring"
  );

  const testingPatterns = memory.getSuccessPatternsFor("testing");
  expect(testingPatterns.length).toBe(1);
  if (testingPatterns.length > 0) {
    expect(testingPatterns[0]!.description).toBe("Create test file");
  }
});

test("CodebaseContextManager: file info creation", async () => {
  const manager = new CodebaseContextManager(process.cwd());
  
  await manager.indexCodebase();

  const fileInfo = manager.getIndex().files.get("package.json");
  expect(fileInfo).toBeTruthy();
  expect(fileInfo?.type).toBe("file");
  expect(fileInfo?.language).toBe("json");
});

test("ActionPlanner: create mutation plan", async () => {
  const planner = new ActionPlanner();

  const plan = await planner.createMutationPlan(
    "Create a test file for ActionTracker",
    {
      codebasePath: process.cwd(),
    }
  );

  expect(plan.steps.length).toBeGreaterThan(0);
  expect(plan.description).toBe(
    "Create a test file for ActionTracker"
  );
  if (plan.steps.length > 0) {
    expect(plan.steps[0]!.type).toBe("file_create");
  }
});

test("ActionPlanner: plan for file creation", async () => {
  const planner = new ActionPlanner();

  const plan = await planner.createMutationPlan("Create a new file called utils", {
    codebasePath: process.cwd(),
  });

  expect(plan.steps.length).toBeGreaterThan(0);
  if (plan.steps.length > 0) {
    expect(plan.steps[0]!.path).toContain("utils");
    expect(plan.steps[0]!.type).toBe("file_create");
  }
});

test("ActionPlanner: plan for deletion (high risk)", async () => {
  const planner = new ActionPlanner();

  const plan = await planner.createMutationPlan("Remove the old service file", {
    codebasePath: process.cwd(),
  });

  expect(plan.steps.length).toBeGreaterThan(0);
  if (plan.steps.length > 0) {
    expect(plan.steps[0]!.type).toBe("file_delete");
    expect(plan.steps[0]!.estimatedRisk).toBe("high");
    expect(plan.steps[0]!.requiresApproval).toBe(true);
  }
  expect(plan.requiresApproval).toBe(true);
});

test("ReflectionEngine: validate file creation", async () => {
  const engine = new ReflectionEngine(process.cwd());

  const action: ActionLog = {
    id: "test-1",
    timestamp: new Date(),
    type: "file_create",
    path: "src/nonexistent.ts", // This file doesn't exist
    details: {
      reasoning: "Create test",
    },
    status: "executed",
    userApproved: true,
    isMutation: true,
  };

  const result = await engine.validateMutation(action, {
    success: false,
    mutationId: "test-1",
    error: "File not created",
    executedAt: new Date(),
  });

  expect(result.valid).toBe(false);
  expect(result.issues.length).toBeGreaterThan(0);
});

test("ActionTracker: get summary statistics", () => {
  const tracker = new ActionTracker();

  tracker.log({
    type: "file_create",
    path: "src/file1.ts",
    details: {},
  });

  tracker.log({
    type: "file_modify",
    path: "src/file2.ts",
    details: {},
  });

  const summary = tracker.getSummary();

  expect(summary.totalActions).toBe(2);
  expect(summary.totalMutations).toBe(2);
  expect(summary.pending).toBe(2);
  expect(summary.executed).toBe(0);
});

test("SessionMemoryManager: memory export/import", () => {
  const memory1 = new SessionMemoryManager("session-1");

  memory1.addConstraint("forbidden_path", ".env", "Secret file");
  memory1.recordError("ENOENT", "File not found");

  const exported = memory1.export();

  const memory2 = new SessionMemoryManager("session-2");
  memory2.import(exported);

  const constraints = memory2.getConstraints();
  expect(constraints.length).toBe(1);

  const errorPattern = memory2.getTopErrorPatterns(1);
  expect(errorPattern.length).toBeGreaterThan(0);
  if (errorPattern.length > 0) {
    expect(errorPattern[0]!.pattern).toBe("ENOENT");
  }
});

test("ActionTracker: clear for new session", () => {
  const tracker = new ActionTracker();

  tracker.log({
    type: "file_create",
    path: "src/file.ts",
    details: {},
  });

  expect(tracker.getActions().length).toBe(1);

  tracker.clear();

  expect(tracker.getActions().length).toBe(0);
});
