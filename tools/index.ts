// tools/index.ts
// Tool registry — maps tool names to definitions, handles consent, routes execution

import type { ToolDefinition, ToolContext } from "../modes/agent/types.js";
import { webSearchTool } from "./web-search.js";
import { webFetchTool } from "./web-fetch.js";
import { codeExecTool } from "./code-exec.js";
import { fileReadTool, fileWriteTool, listDirTool } from "./file-tools.js";
import { appControlTool } from "./apps/index.js";
import { canvasControlTool } from "./canvas-tools.js";

export const TOOLS: Record<string, ToolDefinition> = {
  web_search: webSearchTool,
  web_fetch:  webFetchTool,
  code_exec:  codeExecTool,
  file_read:  fileReadTool,
  file_write: fileWriteTool,
  list_dir:   listDirTool,
  app_control: appControlTool,
  canvas_control: canvasControlTool,
};

import { loadDynamicSkills } from "./dynamic-loader.js";

export async function initDynamicSkills(workspacePath: string): Promise<void> {
  const dynamicTools = await loadDynamicSkills(workspacePath);
  for (const [name, tool] of Object.entries(dynamicTools)) {
    TOOLS[name] = tool;
  }
}

export interface ToolRunResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Run a tool by name.
 * Risky tools are gated behind context.requestConsent().
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolRunResult> {
  const tool = TOOLS[name];
  if (!tool) {
    return { success: false, error: `Unknown tool: "${name}"` };
  }

  // Risky tools always require consent
  if (tool.risky) {
    const preview = `Tool: ${tool.name}\nArgs: ${JSON.stringify(args, null, 2)}`;
    let approved: boolean;
    try {
      approved = await context.requestConsent(tool.name, preview);
    } catch {
      approved = false;
    }

    if (!approved) {
      return { success: false, error: "User declined" };
    }
  }

  try {
    const data = await tool.execute(args, context);
    return { success: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * List all available tools (name + description + risk level)
 */
export function listTools(): Array<{ name: string; description: string; risky: boolean; readOnly: boolean }> {
  return Object.values(TOOLS).map((t) => ({
    name: t.name,
    description: t.description,
    risky: t.risky,
    readOnly: t.readOnly,
  }));
}
