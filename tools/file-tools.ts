// tools/file-tools.ts
// File read/write/list tools — full device access, no path sandbox.
// file_write performs an automatic syntax check after writing code files (.py, .sh, .ts, .js)
// so the LLM immediately knows if it wrote syntactically invalid code.

import type { ToolDefinition } from "../modes/agent/types.js";
import os from "os";
import path from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { spawnSync } from "child_process";

/** Resolve a path that may be relative OR absolute. Supports ~/ home notation. */
function resolvePath(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return path.resolve(os.homedir(), inputPath.slice(2));
  }
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(process.cwd(), inputPath);
}

/**
 * Run a quick syntax-only check on the written file based on its extension.
 * Returns "OK" on clean parse, or a short error message on failure.
 * Returns null for unsupported file types (no check needed).
 */
function syntaxCheck(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".py") {
    // Python syntax check — py_compile exits 0 on success, 1 on error
    const result = spawnSync("python3", ["-m", "py_compile", filePath], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.error) return null; // python3 not available — skip
    if (result.status !== 0) {
      const msg = (result.stderr ?? "").trim();
      // Strip the leading "  File ..." line for brevity
      const firstError = msg.split("\n").slice(-2).join(" ").trim();
      return `SYNTAX ERROR: ${firstError || msg}`;
    }
    return "OK";
  }

  if (ext === ".sh" || ext === ".bash") {
    // Bash syntax check — bash -n never executes, just parses
    const result = spawnSync("bash", ["-n", filePath], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (result.error) return null; // bash not available
    if (result.status !== 0) {
      const msg = (result.stderr ?? "").trim();
      return `SYNTAX ERROR: ${msg}`;
    }
    return "OK";
  }

  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs") {
    // Bun type-check (fast — uses Bun's built-in TS parser)
    // bun --check is silent on success, prints errors on failure
    const result = spawnSync("bun", ["--check", filePath], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.error) return null; // bun not available
    if (result.status !== 0) {
      const msg = ((result.stderr ?? "") + (result.stdout ?? "")).trim();
      const firstLine = msg.split("\n")[0]?.trim() ?? msg;
      return `SYNTAX ERROR: ${firstLine}`;
    }
    return "OK";
  }

  // JSON — use Node's JSON.parse
  if (ext === ".json") {
    try {
      const content = readFileSync(filePath, "utf8");
      JSON.parse(content);
      return "OK";
    } catch (e: any) {
      return `SYNTAX ERROR: ${e.message}`;
    }
  }

  return null; // No check for other file types
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
  description:
    "Write or create any file anywhere on the device. " +
    "For code files (.py, .sh, .ts, .js, .json) automatically runs a syntax check after writing " +
    "and returns a 'syntaxCheck' field so you know immediately if the code is valid.",
  risky: false,
  readOnly: false,
  execute: async (args) => {
    const filePath = resolvePath(args.path as string);
    const dir = path.dirname(filePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, args.content as string, "utf8");

    // Count lines for a useful summary
    const lines = (args.content as string).split("\n").length;

    // Auto syntax-check code files
    const syntaxResult = syntaxCheck(filePath);

    if (syntaxResult !== null) {
      return {
        written: true,
        path: filePath,
        lines,
        syntaxCheck: syntaxResult,
        ...(syntaxResult !== "OK"
          ? {
              action:
                "Syntax check FAILED. Call file_read to inspect the file, fix the error, " +
                "call file_write again with the corrected content, then re-run.",
            }
          : { action: "Syntax check passed. File is ready to run." }),
      };
    }

    return {
      written: true,
      path: filePath,
      lines,
    };
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
