import { randomUUID } from "crypto";
import type { ActionLog, ActionStatus, ActionType } from "./types";
import { isMutationType } from "./types";

export class ActionTracker {
  private actions: ActionLog[] = [];
  private actionIndex: Map<string, ActionLog> = new Map();

  /**
   * Log an action (file operation, analysis, etc)
   */
  log(entry: Omit<ActionLog, "id" | "timestamp" | "status" | "userApproved" | "isMutation">): ActionLog {
    const action: ActionLog = {
      id: randomUUID(),
      timestamp: new Date(),
      type: entry.type,
      path: entry.path,
      details: entry.details,
      status: "pending",
      userApproved: false,
      isMutation: isMutationType(entry.type),
    };

    this.actions.push(action);
    this.actionIndex.set(action.id, action);

    return action;
  }

  /**
   * Get all logged actions
   */
  getActions(): ActionLog[] {
    return this.actions;
  }

  /**
   * Get actions by type
   */
  getActionsByType(type: ActionType): ActionLog[] {
    return this.actions.filter((a) => a.type === type);
  }

  /**
   * Get all pending mutations (file operations, shell commands)
   */
  getPendingMutations(): ActionLog[] {
    return this.actions.filter((a) => a.isMutation && a.status === "pending");
  }

  /**
   * Get approved mutations ready for execution
   */
  getApprovedMutations(): ActionLog[] {
    return this.actions.filter((a) => a.isMutation && a.status === "approved");
  }

  /**
   * Get executed mutations
   */
  getExecutedMutations(): ActionLog[] {
    return this.actions.filter((a) => a.isMutation && a.status === "executed");
  }

  /**
   * Get failed mutations
   */
  getFailedMutations(): ActionLog[] {
    return this.actions.filter((a) => a.isMutation && a.status === "failed");
  }

  /**
   * Update action status
   */
  updateStatus(id: string, status: ActionStatus, details?: Partial<ActionLog["details"]>): boolean {
    const action = this.actionIndex.get(id);
    if (!action) return false;

    action.status = status;
    if (details) {
      action.details = { ...action.details, ...details };
    }

    return true;
  }

  /**
   * Approve an action for execution
   */
  approveAction(id: string, reasoning?: string): boolean {
    const action = this.actionIndex.get(id);
    if (!action) return false;

    action.userApproved = true;
    action.status = "approved";
    if (reasoning) {
      action.details.reasoning = reasoning;
    }

    return true;
  }

  /**
   * Reject an action
   */
  rejectAction(id: string, reason?: string): boolean {
    const action = this.actionIndex.get(id);
    if (!action) return false;

    action.status = "rejected";
    if (reason) {
      action.details.error = reason;
    }

    return true;
  }

  /**
   * Get action by ID
   */
  getAction(id: string): ActionLog | null {
    return this.actionIndex.get(id) || null;
  }

  /**
   * Get actions for a specific path
   */
  getActionsForPath(path: string): ActionLog[] {
    return this.actions.filter((a) => a.path === path || a.path.startsWith(path));
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalActions: number;
    totalMutations: number;
    pending: number;
    executed: number;
    failed: number;
    approved: number;
    rejected: number;
  } {
    return {
      totalActions: this.actions.length,
      totalMutations: this.actions.filter((a) => a.isMutation).length,
      pending: this.actions.filter((a) => a.status === "pending").length,
      executed: this.actions.filter((a) => a.status === "executed").length,
      failed: this.actions.filter((a) => a.status === "failed").length,
      approved: this.actions.filter((a) => a.status === "approved").length,
      rejected: this.actions.filter((a) => a.status === "rejected").length,
    };
  }

  /**
   * Clear all actions (for testing or new session)
   */
  clear(): void {
    this.actions = [];
    this.actionIndex.clear();
  }

  /**
   * Export actions (for persistence/debugging)
   */
  export(): ActionLog[] {
    return JSON.parse(JSON.stringify(this.actions));
  }
}