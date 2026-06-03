import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, appendFileSync } from "fs";
import { resolve, dirname, join } from "path";
import type { AgentConfig, ActionLog } from "./types";
import type { SessionMemory } from "./types";
import { SessionMemoryManager } from "./session-memory";
import { ActionTracker } from "./action-tracker";
import { ActionHistory } from "./action-history";
import { Logger } from "../../utils/logger";

const SESSIONS_DIR = ".pandaclaw/sessions";
const ACTIVE_FILE = "active";
const MANIFEST_FILE = "manifest.json";
const SESSION_FILE = "session.json";
const MESSAGES_FILE = "messages.jsonl";
const ACTIONS_FILE = "actions.json";

export interface SessionMeta {
  id: string;
  name: string;
  goal: string;
  status: SessionStatus;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  iterationCount: number;
}

export type SessionStatus = "active" | "paused" | "completed" | "failed";

export interface SessionData {
  id: string;
  name: string;
  goal: string;
  status: SessionStatus;
  workspacePath: string;
  config: AgentConfig;
  createdAt: string;
  updatedAt: string;
  iterationCount: number;
  maxIterations: number;
  messageCount: number;
}

export interface StoredSession {
  data: SessionData;
  memory: ReturnType<SessionMemoryManager["export"]>;
  actions: ActionLog[];
  messages: Array<{ role: string; content: string; timestamp: number }>;
}

export class SessionManager {
  private sessionsDir: string;
  private logger: Logger;

  constructor(basePath?: string) {
    this.sessionsDir = resolve(basePath || process.cwd(), SESSIONS_DIR);
    this.logger = new Logger("session-manager", ".pandaclaw");
    this.ensureDir();
  }

  // ==================== CRUD ====================

  createSession(name: string, goal: string, workspacePath: string, config: AgentConfig): SessionData {
    this.ensureDir();

    const id = "sess_" + randomUUID().replace(/-/g, "").slice(0, 12);
    const now = new Date().toISOString();

    const session: SessionData = {
      id,
      name,
      goal,
      status: "active",
      workspacePath,
      config,
      createdAt: now,
      updatedAt: now,
      iterationCount: 0,
      maxIterations: config?.approvalThresholds?.autoExecuteMutationLimit || 20,
      messageCount: 0,
    };

    const sessionDir = this.sessionDir(id);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, SESSION_FILE), JSON.stringify(session, null, 2), "utf8");
    writeFileSync(join(sessionDir, ACTIONS_FILE), "[]", "utf8");

    this.setActive(id);
    this.updateManifest();
    this.logger.info("Session created", { id, name, goal: goal.slice(0, 80) });

    return session;
  }

  loadSession(id: string): StoredSession | null {
    const sessionDir = this.sessionDir(id);
    const sessionPath = join(sessionDir, SESSION_FILE);
    if (!existsSync(sessionPath)) return null;

    try {
      const data: SessionData = JSON.parse(readFileSync(sessionPath, "utf8"));
      const actions: ActionLog[] = existsSync(join(sessionDir, ACTIONS_FILE))
        ? JSON.parse(readFileSync(join(sessionDir, ACTIONS_FILE), "utf8"))
        : [];
      const messages = this.readMessages(id);
      const memory = this.readMemory(id);

      return { data, memory, actions, messages };
    } catch (err: any) {
      this.logger.error("Failed to load session", { id, error: err.message });
      return null;
    }
  }

  saveSession(id: string, overrides: Partial<SessionData>): boolean {
    const sessionDir = this.sessionDir(id);
    const sessionPath = join(sessionDir, SESSION_FILE);
    if (!existsSync(sessionPath)) return false;

    try {
      const current: SessionData = JSON.parse(readFileSync(sessionPath, "utf8"));
      const updated: SessionData = {
        ...current,
        ...overrides,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(sessionPath, JSON.stringify(updated, null, 2), "utf8");
      this.updateManifest();
      return true;
    } catch (err: any) {
      this.logger.error("Failed to save session", { id, error: err.message });
      return false;
    }
  }

  saveActions(id: string, actions: ActionLog[]): boolean {
    const sessionDir = this.sessionDir(id);
    if (!existsSync(sessionDir)) return false;
    try {
      writeFileSync(join(sessionDir, ACTIONS_FILE), JSON.stringify(actions, null, 2), "utf8");
      return true;
    } catch (err: any) {
      this.logger.error("Failed to save actions", { id, error: err.message });
      return false;
    }
  }

  deleteSession(id: string): boolean {
    const sessionDir = this.sessionDir(id);
    if (!existsSync(sessionDir)) return false;
    try {
      rmSync(sessionDir, { recursive: true, force: true });

      const active = this.getActiveId();
      if (active === id) {
        writeFileSync(this.activePath(), "", "utf8");
      }

      this.updateManifest();
      this.logger.info("Session deleted", { id });
      return true;
    } catch (err: any) {
      this.logger.error("Failed to delete session", { id, error: err.message });
      return false;
    }
  }

  listSessions(): SessionMeta[] {
    this.ensureDir();
    const manifestPath = join(this.sessionsDir, MANIFEST_FILE);
    if (!existsSync(manifestPath)) return [];
    try {
      return JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      return [];
    }
  }

  // ==================== Active Session ====================

  setActive(id: string): void {
    try {
      writeFileSync(this.activePath(), id, "utf8");
    } catch {}
  }

  getActiveId(): string | null {
    const path = this.activePath();
    if (!existsSync(path)) return null;
    try {
      const id = readFileSync(path, "utf8").trim();
      return id || null;
    } catch {
      return null;
    }
  }

  getActiveSession(): StoredSession | null {
    const id = this.getActiveId();
    if (!id) return null;
    return this.loadSession(id);
  }

  switchSession(id: string): boolean {
    const sessionDir = this.sessionDir(id);
    if (!existsSync(sessionDir)) return false;
    this.setActive(id);
    this.saveSession(id, { status: "active" } as any);

    const previous = this.getPreviousActiveId(id);
    if (previous) {
      this.saveSession(previous, { status: "paused" } as any);
    }

    this.logger.info("Switched session", { id });
    return true;
  }

  // ==================== Messages ====================

  addMessage(id: string, role: string, content: string): void {
    const sessionDir = this.sessionDir(id);
    if (!existsSync(sessionDir)) return;
    try {
      const entry = JSON.stringify({ role, content, timestamp: Date.now() }) + "\n";
      appendFileSync(join(sessionDir, MESSAGES_FILE), entry, "utf8");

      const current: SessionData = JSON.parse(readFileSync(join(sessionDir, SESSION_FILE), "utf8"));
      current.messageCount = (current.messageCount || 0) + 1;
      current.updatedAt = new Date().toISOString();
      writeFileSync(join(sessionDir, SESSION_FILE), JSON.stringify(current, null, 2), "utf8");

      this.updateManifest();
    } catch (err: any) {
      this.logger.error("Failed to add message", { id, error: err.message });
    }
  }

  getMessages(id: string): Array<{ role: string; content: string; timestamp: number }> {
    return this.readMessages(id);
  }

  // ==================== Status ====================

  updateStatus(id: string, status: SessionStatus): boolean {
    return this.saveSession(id, { status } as any);
  }

  // ==================== Private Helpers ====================

  private sessionDir(id: string): string {
    return join(this.sessionsDir, id);
  }

  private activePath(): string {
    return join(this.sessionsDir, ACTIVE_FILE);
  }

  private ensureDir(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  private updateManifest(): void {
    try {
      const dirs = readdirSync(this.sessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("sess_"))
        .map((d) => d.name);

      const activeId = this.getActiveId();
      const entries: SessionMeta[] = [];

      for (const dir of dirs) {
        const sessionPath = join(this.sessionsDir, dir, SESSION_FILE);
        if (!existsSync(sessionPath)) continue;
        try {
          const data: SessionData = JSON.parse(readFileSync(sessionPath, "utf8"));
          entries.push({
            id: data.id,
            name: data.name,
            goal: data.goal,
            status: data.id === activeId ? "active" : data.status,
            workspacePath: data.workspacePath,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            messageCount: data.messageCount || 0,
            iterationCount: data.iterationCount || 0,
          });
        } catch {}
      }

      entries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      writeFileSync(join(this.sessionsDir, MANIFEST_FILE), JSON.stringify(entries, null, 2), "utf8");
    } catch {}
  }

  private getPreviousActiveId(currentId: string): string | null {
    const sessions = this.listSessions();
    const active = sessions.find((s) => s.status === "active" && s.id !== currentId);
    return active?.id || null;
  }

  private readMessages(id: string): Array<{ role: string; content: string; timestamp: number }> {
    const path = join(this.sessionDir(id), MESSAGES_FILE);
    if (!existsSync(path)) return [];
    try {
      const content = readFileSync(path, "utf8");
      const messages: Array<{ role: string; content: string; timestamp: number }> = [];
      for (const line of content.split("\n").filter(Boolean)) {
        try {
          messages.push(JSON.parse(line));
        } catch {}
      }
      return messages;
    } catch {
      return [];
    }
  }

  private readMemory(id: string): ReturnType<SessionMemoryManager["export"]> {
    const path = join(this.sessionDir(id), "memory.json");
    if (!existsSync(path)) {
      const mem = new SessionMemoryManager(id);
      return mem.export();
    }
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      return {
        sessionId: raw.sessionId || id,
        createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
        learnedConstraints: raw.learnedConstraints || [],
        errorPatterns: new Map(raw.errorPatterns || []),
        contextCache: new Map(raw.contextCache || []),
        successPatterns: raw.successPatterns || [],
        actionsSinceLastReflection: raw.actionsSinceLastReflection || 0,
        reflections: raw.reflections || [],
      };
    } catch {
      const mem = new SessionMemoryManager(id);
      return mem.export();
    }
  }

  saveMemory(id: string, memory: ReturnType<SessionMemoryManager["export"]>): boolean {
    const path = join(this.sessionDir(id), "memory.json");
    if (!existsSync(this.sessionDir(id))) return false;
    try {
      const serializable = {
        ...memory,
        errorPatterns: Array.from(memory.errorPatterns.entries()),
        contextCache: Array.from(memory.contextCache.entries()),
      };
      writeFileSync(path, JSON.stringify(serializable, null, 2), "utf8");
      return true;
    } catch (err: any) {
      this.logger.error("Failed to save memory", { id, error: err.message });
      return false;
    }
  }
}

let _globalSessionManager: SessionManager | null = null;

export function getSessionManager(basePath?: string): SessionManager {
  if (!_globalSessionManager) {
    _globalSessionManager = new SessionManager(basePath);
  }
  return _globalSessionManager;
}

export function resetSessionManager(): void {
  _globalSessionManager = null;
}
