// modes/agent/workspace-manager.ts
// Manages named workspace isolation contexts for PandaClaw.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";

const HOME = os.homedir();
const PANDA_DIR = path.join(HOME, ".pandaclaw");
const WORKSPACES_FILE = path.join(PANDA_DIR, "workspaces.json");
const ACTIVE_FILE = path.join(PANDA_DIR, "active_workspace.txt");

export interface Workspace {
  name: string;
  path: string;             // Working directory for execution
  memoryDir: string;        // ~/.pandaclaw/workspaces/<name>
  createdAt: number;
  lastUsed: number;
}

export class WorkspaceManager {
  private workspaces: Workspace[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    if (!existsSync(PANDA_DIR)) {
      mkdirSync(PANDA_DIR, { recursive: true });
    }
    if (!existsSync(WORKSPACES_FILE)) {
      this.workspaces = [];
      return;
    }
    try {
      this.workspaces = JSON.parse(readFileSync(WORKSPACES_FILE, "utf8"));
    } catch {
      this.workspaces = [];
    }
  }

  private save(): void {
    try {
      writeFileSync(WORKSPACES_FILE, JSON.stringify(this.workspaces, null, 2), "utf8");
    } catch (err: any) {
      console.error(chalk.red(`Failed to save workspaces list: ${err.message}`));
    }
  }

  public create(name: string, dirPath: string): Workspace {
    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9\-_]/g, "");
    if (!cleanName) {
      throw new Error("Invalid workspace name. Use alphanumeric characters, dashes, or underscores.");
    }

    if (this.workspaces.some(w => w.name === cleanName)) {
      throw new Error(`Workspace "${cleanName}" already exists.`);
    }

    const memoryDir = path.join(PANDA_DIR, "workspaces", cleanName);
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true });
    }

    const ws: Workspace = {
      name: cleanName,
      path: path.resolve(dirPath),
      memoryDir,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    this.workspaces.push(ws);
    this.save();
    return ws;
  }

  public switchWorkspace(name: string): void {
    const cleanName = name.trim().toLowerCase();
    if (cleanName === "default") {
      try {
        writeFileSync(ACTIVE_FILE, "default", "utf8");
        console.log(chalk.green(`✓ Switched to workspace "default" (local directory context)`));
      } catch (err: any) {
        throw new Error(`Failed to write active workspace: ${err.message}`);
      }
      return;
    }

    const ws = this.workspaces.find(w => w.name === cleanName);
    if (!ws) {
      throw new Error(`Workspace "${cleanName}" not found.`);
    }

    ws.lastUsed = Date.now();
    this.save();

    try {
      writeFileSync(ACTIVE_FILE, cleanName, "utf8");
      console.log(chalk.green(`✓ Switched to workspace "${cleanName}"`));
    } catch (err: any) {
      throw new Error(`Failed to write active workspace: ${err.message}`);
    }
  }

  public getActiveName(): string {
    if (existsSync(ACTIVE_FILE)) {
      try {
        return readFileSync(ACTIVE_FILE, "utf8").trim() || "default";
      } catch {}
    }
    return "default";
  }

  public getActive(): Workspace | null {
    const activeName = this.getActiveName();
    if (activeName === "default") return null;
    return this.workspaces.find(w => w.name === activeName) || null;
  }

  public list(): Workspace[] {
    return this.workspaces;
  }

  public deleteWorkspace(name: string): void {
    const cleanName = name.trim().toLowerCase();
    const ws = this.workspaces.find(w => w.name === cleanName);
    if (!ws) {
      throw new Error(`Workspace "${cleanName}" not found.`);
    }

    // Remove workspace folder recursively
    if (existsSync(ws.memoryDir)) {
      try {
        rmSync(ws.memoryDir, { recursive: true, force: true });
      } catch (err: any) {
        console.warn(chalk.yellow(`⚠️ Could not delete memory directory: ${err.message}`));
      }
    }

    this.workspaces = this.workspaces.filter(w => w.name !== cleanName);
    this.save();

    // If active was deleted, reset to default
    if (this.getActiveName() === cleanName) {
      this.switchWorkspace("default");
    }
  }
}
