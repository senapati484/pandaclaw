import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { Logger } from "../../utils/logger";

interface Snapshot {
  path: string;
  content: string | null;
  type: "file_create" | "file_modify" | "file_delete" | "folder_create" | "folder_delete" | "shell_command";
  rationale: string;
  timestamp: number;
}

export class ActionHistory {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private workspacePath: string;
  private logger: Logger;

  constructor(workspacePath: string, logger: Logger) {
    this.workspacePath = workspacePath;
    this.logger = logger;
  }

  snapshotBefore(path: string, type: Snapshot["type"], rationale: string): void {
    const fullPath = resolve(this.workspacePath, path);
    let content: string | null = null;

    if (existsSync(fullPath) && (type === "file_modify" || type === "file_delete")) {
      try {
        content = readFileSync(fullPath, "utf8");
      } catch {}
    }

    const snapshot: Snapshot = {
      path,
      content,
      type,
      rationale,
      timestamp: Date.now(),
    };

    this.undoStack.push(snapshot);
    this.redoStack = [];
  }

  undo(): { success: boolean; description: string } {
    const snapshot = this.undoStack.pop();
    if (!snapshot) {
      return { success: false, description: "Nothing to undo" };
    }

    const fullPath = resolve(this.workspacePath, snapshot.path);

    try {
      switch (snapshot.type) {
        case "file_create": {
          if (existsSync(fullPath)) {
            try { writeFileSync(fullPath, ""); } catch {}
          }
          this.redoStack.push(snapshot);
          return { success: true, description: `Undid creation of ${snapshot.path}` };
        }
        case "file_modify":
        case "file_delete": {
          if (snapshot.content !== null) {
            writeFileSync(fullPath, snapshot.content, "utf8");
          }
          this.redoStack.push(snapshot);
          return { success: true, description: `Restored ${snapshot.path} from snapshot` };
        }
        default:
          this.redoStack.push(snapshot);
          return { success: true, description: `Undid ${snapshot.type} on ${snapshot.path}` };
      }
    } catch (err: any) {
      this.undoStack.push(snapshot);
      this.logger.error("Undo failed", { path: snapshot.path, error: err.message });
      return { success: false, description: `Undo failed: ${err.message}` };
    }
  }

  redo(): { success: boolean; description: string } {
    const snapshot = this.redoStack.pop();
    if (!snapshot) {
      return { success: false, description: "Nothing to redo" };
    }

    this.undoStack.push(snapshot);
    return { success: true, description: `Redo: ${snapshot.type} on ${snapshot.path}` };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undoCount(): number {
    return this.undoStack.length;
  }

  redoCount(): number {
    return this.redoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  getLastSnapshot(): Snapshot | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  getUndoHistory(): Snapshot[] {
    return [...this.undoStack];
  }
}
