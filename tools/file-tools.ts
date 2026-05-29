// tools/file-tools.ts
// File read/write/list tools that operate within the workspace directory

import type { ToolDefinition } from "../modes/agent/types.js";
import path from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";

export const fileReadTool: ToolDefinition = {
  name: "file_read",
  description: "Read a file from the workspace",
  risky: false,
  readOnly: true,
  execute: async (args, ctx) => {
    const filePath = path.resolve(ctx.workspacePath, args.path as string);

    // Safety: must be within workspace
    if (!filePath.startsWith(ctx.workspacePath)) {
      throw new Error("Path traversal attempt blocked");
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${args.path}`);
    }

    return readFileSync(filePath, "utf8");
  },
};

export const fileWriteTool: ToolDefinition = {
  name: "file_write",
  description: "Write content to a file in the workspace",
  risky: true,
  readOnly: false,
  execute: async (args, ctx) => {
    const filePath = path.resolve(ctx.workspacePath, args.path as string);

    // Safety: must be within workspace
    if (!filePath.startsWith(ctx.workspacePath)) {
      throw new Error("Path traversal attempt blocked");
    }

    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, args.content as string, "utf8");
    return `Written: ${args.path}`;
  },
};

export const listDirTool: ToolDefinition = {
  name: "list_dir",
  description: "List files and directories in the workspace",
  risky: false,
  readOnly: true,
  execute: async (args, ctx) => {
    const relativeDir = (args.path as string) || ".";
    const dirPath = path.resolve(ctx.workspacePath, relativeDir);

    // Safety: must be within workspace
    if (!dirPath.startsWith(ctx.workspacePath)) {
      throw new Error("Path traversal attempt blocked");
    }

    if (!existsSync(dirPath)) {
      throw new Error(`Directory not found: ${relativeDir}`);
    }

    const recursive = args.recursive === true;

    const getFiles = (dir: string, depth = 0): string[] => {
      if (depth > 5) return []; // limit recursion depth
      const entries = readdirSync(dir, { withFileTypes: true });
      let files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(ctx.workspacePath, fullPath);

        // Skip hidden files/directories and node_modules
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }

        if (entry.isDirectory()) {
          files.push(relPath + "/");
          if (recursive) {
            files.push(...getFiles(fullPath, depth + 1));
          }
        } else {
          files.push(relPath);
        }
      }
      return files;
    };

    const files = getFiles(dirPath);
    return files.length > 0 ? files.join("\n") : "(empty directory)";
  },
};
