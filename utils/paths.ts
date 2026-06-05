// utils/paths.ts
import path from "path";
import * as os from "os";
import { existsSync, readFileSync } from "fs";

export function getActiveWorkspace(): string {
  if (process.env.PANDACLAW_TEST_WORKSPACE) {
    return process.env.PANDACLAW_TEST_WORKSPACE;
  }
  if (process.env.NODE_ENV === "test") {
    return "default";
  }
  const activeFile = path.join(os.homedir(), ".pandaclaw", "active_workspace.txt");
  if (existsSync(activeFile)) {
    try {
      return readFileSync(activeFile, "utf8").trim() || "default";
    } catch {}
  }
  return "default";
}

export function getMemoryDir(): string {
  const active = getActiveWorkspace();
  if (active === "default") {
    return ".pandaclaw";
  }
  return path.join(os.homedir(), ".pandaclaw", "workspaces", active);
}
