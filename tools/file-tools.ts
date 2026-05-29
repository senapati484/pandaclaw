// tools/file-tools.ts
// File read/write/list tools — full device access, no path sandbox.

import type { ToolDefinition } from "../modes/agent/types.js";
import os from "os";
import path from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";

/** Resolve a path that may be relative OR absolute. Supports ~/ home notation and falls back to process.cwd() for relative paths. */
function resolvePath(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return path.resolve(os.homedir(), inputPath.slice(2));
  }
  if (path.isAbsolute(inputPath)) return inputPath;
  // Relative paths resolve from the current working directory of the project
  return path.resolve(process.cwd(), inputPath);
}

export const fileReadTool: ToolDefinition = {
  name: "file_read",
  description: "Read any file anywhere on the device",
  risky: false,
  readOnly: true,
  execute: async (args) => {
    const filePath = resolvePath(args.path as string);

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return readFileSync(filePath, "utf8");
  },
};

export const fileWriteTool: ToolDefinition = {
  name: "file_write",
  description: "Write or create any file anywhere on the device",
  risky: false,           // ← no consent gate for Telegram (already authorized user)
  readOnly: false,
  execute: async (args) => {
    const filePath = resolvePath(args.path as string);
    const dir = path.dirname(filePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, args.content as string, "utf8");
    return `✅ Written to: ${filePath}`;
  },
};

export const listDirTool: ToolDefinition = {
  name: "list_dir",
  description: "List files and directories at any path on the device",
  risky: false,
  readOnly: true,
  execute: async (args) => {
    const inputPath = (args.path as string) || os.homedir();
    const dirPath = resolvePath(inputPath);
    const recursive = args.recursive === true;

    if (!existsSync(dirPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const getFiles = (dir: string, depth = 0): string[] => {
      if (depth > 4) return []; // limit depth to avoid huge outputs
      const entries = readdirSync(dir, { withFileTypes: true });
      let files: string[] = [];
      for (const entry of entries) {
        // Skip heavy/irrelevant directories
        if (["node_modules", ".git", ".cache", "__pycache__", ".DS_Store"].includes(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          files.push(fullPath + "/");
          if (recursive) {
            files.push(...getFiles(fullPath, depth + 1));
          }
        } else {
          files.push(fullPath);
        }
      }
      return files;
    };

    const files = getFiles(dirPath);
    return files.length > 0 ? files.join("\n") : "(empty directory)";
  },
};
