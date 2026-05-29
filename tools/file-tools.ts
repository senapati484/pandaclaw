// tools/file-tools.ts
// File read/write tools that operate within the workspace directory

import type { ToolDefinition } from "../modes/agent/types.js";
import path from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

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
