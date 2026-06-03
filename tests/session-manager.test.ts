import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { resolve } from "path";
import { SessionManager, resetSessionManager, getSessionManager } from "../modes/agent/session-manager";
import { defaultAgentConfig } from "../modes/agent/types";

const TEST_SESSIONS_DIR = resolve(import.meta.dir, "../.pandaclaw-test-sessions");

beforeEach(() => {
  resetSessionManager();
  if (!existsSync(TEST_SESSIONS_DIR)) {
    mkdirSync(TEST_SESSIONS_DIR, { recursive: true });
  }
});

afterEach(() => {
  if (existsSync(TEST_SESSIONS_DIR)) {
    rmSync(TEST_SESSIONS_DIR, { recursive: true, force: true });
  }
});

test("createSession creates a session directory and sets it active", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  const session = sm.createSession("test-session", "Fix the bug", "/workspace", defaultAgentConfig());

  expect(session.id).toBeTruthy();
  expect(session.name).toBe("test-session");
  expect(session.goal).toBe("Fix the bug");
  expect(session.status).toBe("active");
  expect(sm.getActiveId()).toBe(session.id);
});

test("loadSession returns null for nonexistent session", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  const loaded = sm.loadSession("sess_nonexistent");
  expect(loaded).toBeNull();
});

test("loadSession returns stored session data", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  const created = sm.createSession("load-test", "Test loading", "/ws", defaultAgentConfig());

  const loaded = sm.loadSession(created.id);
  expect(loaded).not.toBeNull();
  expect(loaded!.data.id).toBe(created.id);
  expect(loaded!.data.name).toBe("load-test");
  expect(loaded!.data.goal).toBe("Test loading");
  expect(loaded!.actions).toEqual([]);
  expect(loaded!.messages).toEqual([]);
});

test("listSessions returns all sessions sorted by updatedAt", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  sm.createSession("first", "First goal", "/ws1", defaultAgentConfig());
  sm.createSession("second", "Second goal", "/ws2", defaultAgentConfig());

  const list = sm.listSessions();
  expect(list.length).toBe(2);
  expect(list[0]!.name).toBe("second");
  expect(list[1]!.name).toBe("first");
});

test("deleteSession removes session directory", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  const session = sm.createSession("delete-me", "Delete this", "/ws", defaultAgentConfig());

  expect(sm.loadSession(session.id)).not.toBeNull();
  const deleted = sm.deleteSession(session.id);
  expect(deleted).toBe(true);
  expect(sm.loadSession(session.id)).toBeNull();
});

test("switchSession changes active session", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  const s1 = sm.createSession("s1", "Goal 1", "/ws", defaultAgentConfig());
  const s2 = sm.createSession("s2", "Goal 2", "/ws", defaultAgentConfig());

  expect(sm.getActiveId()).toBe(s2.id);
  sm.switchSession(s1.id);
  expect(sm.getActiveId()).toBe(s1.id);

  const sessions = sm.listSessions();
  const active = sessions.find((s) => s.status === "active");
  expect(active?.id).toBe(s1.id);
});

test("addMessage and getMessages round-trip", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  const session = sm.createSession("msg-test", "Test messages", "/ws", defaultAgentConfig());

  sm.addMessage(session.id, "user", "Hello");
  sm.addMessage(session.id, "assistant", "Hi there");

  const messages = sm.getMessages(session.id);
  expect(messages.length).toBe(2);
  expect(messages[0]!.role).toBe("user");
  expect(messages[0]!.content).toBe("Hello");
  expect(messages[1]!.role).toBe("assistant");
  expect(messages[1]!.content).toBe("Hi there");

  const meta = sm.listSessions().find((s) => s.id === session.id);
  expect(meta?.messageCount).toBe(2);
});

test("saveActions and load persists action data", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  const session = sm.createSession("action-test", "Test actions", "/ws", defaultAgentConfig());

  const actions = [
    { id: "a1", timestamp: new Date(), type: "file_create" as const, path: "/test.ts", details: {}, status: "executed" as const, userApproved: true, isMutation: true },
  ];

  const saved = sm.saveActions(session.id, actions);
  expect(saved).toBe(true);

  const loaded = sm.loadSession(session.id);
  expect(loaded?.actions.length).toBe(1);
  expect(loaded?.actions[0]?.id).toBe("a1");
  expect(loaded?.actions[0]?.type).toBe("file_create");
});

test("updateStatus changes session status", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  const session = sm.createSession("status-test", "Test status", "/ws", defaultAgentConfig());

  sm.updateStatus(session.id, "completed");

  const loaded = sm.loadSession(session.id);
  expect(loaded?.data.status).toBe("completed");
});

test("getActiveSession returns the active session", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  sm.createSession("active-test", "Test active", "/ws", defaultAgentConfig());

  const active = sm.getActiveSession();
  expect(active).not.toBeNull();
  expect(active!.data.name).toBe("active-test");
});

test("global getSessionManager returns singleton", () => {
  resetSessionManager();
  const sm1 = getSessionManager(TEST_SESSIONS_DIR);
  const sm2 = getSessionManager(TEST_SESSIONS_DIR);
  expect(sm1).toBe(sm2);
});

test("saveMemory persists memory state", () => {
  const sm = new SessionManager(TEST_SESSIONS_DIR);
  const session = sm.createSession("mem-test", "Test memory", "/ws", defaultAgentConfig());

  const memory = {
    sessionId: session.id,
    createdAt: new Date(),
    learnedConstraints: [{ type: "forbidden_path" as const, value: "node_modules", reason: "too large", confidence: 0.9 }],
    errorPatterns: new Map(),
    contextCache: new Map(),
    successPatterns: [],
    actionsSinceLastReflection: 0,
    reflections: [],
  };

  const saved = sm.saveMemory(session.id, memory as any);
  expect(saved).toBe(true);

  const loaded = sm.loadSession(session.id);
  expect(loaded?.memory.learnedConstraints.length).toBe(1);
  expect(loaded?.memory.learnedConstraints[0]?.value).toBe("node_modules");
});
