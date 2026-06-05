import type { ActionTracker } from "../action-tracker.js";
import type { ActionHistory } from "../action-history.js";
import type { SessionMemoryManager } from "../session-memory.js";

export type SwarmWorkerType = "coder" | "researcher" | "verifier" | "visualizer";

export type SwarmTaskStatus = "pending" | "in_progress" | "completed" | "failed";

export interface SwarmTask {
  id: string;
  name: string;
  description: string;
  workerType: SwarmWorkerType;
  dependencies: string[]; // Task IDs that must finish first
  status: SwarmTaskStatus;
  input?: string;
  result?: string;
  error?: string;
}

export interface SwarmContext {
  workspacePath: string;
  goals: string;
  tasks: Map<string, SwarmTask>;
  history: string[];
  tracker?: ActionTracker;
  actionHistory?: ActionHistory;
  memory?: SessionMemoryManager;
  sessionId?: string;
}
