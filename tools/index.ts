import type { ToolDefinition, ToolContext } from "../modes/agent/types.js";
import { webSearchTool } from "./web-search.js";
import { webFetchTool } from "./web-fetch.js";
import { codeExecTool } from "./code-exec.js";
import { fileReadTool, fileWriteTool, listDirTool } from "./file-tools.js";
import { appControlTool } from "./apps/index.js";
import { canvasControlTool } from "./canvas-tools.js";
import { memoryRecallTool } from "./memory_recall.js";
import { SecurityGuard } from "./security-guard.js";
import { MCPHost, type MCPServerConfig, type MCPServerStatus } from "../mcp/host.js";

let _mcpHost: MCPHost | null = null;

export const TOOLS: Record<string, ToolDefinition> = {
  web_search: webSearchTool,
  web_fetch:  webFetchTool,
  code_exec:  codeExecTool,
  file_read:  fileReadTool,
  file_write: fileWriteTool,
  list_dir:   listDirTool,
  app_control: appControlTool,
  canvas_control: canvasControlTool,
  memory_recall: memoryRecallTool,
};

import { loadDynamicSkills } from "./dynamic-loader.js";
import path from "path";
import * as os from "os";
import { readConfig } from "../ai/ai.config.js";

let _guard: SecurityGuard | null = null;

export function getGuard(): SecurityGuard {
  if (!_guard) {
    const cfg = readConfig();
    _guard = new SecurityGuard(cfg.security, cfg.audit.path);
  }
  return _guard;
}

export function getMCPHost(): MCPHost {
  if (!_mcpHost) {
    _mcpHost = new MCPHost(TOOLS);
  }
  return _mcpHost;
}

export async function initMCPFromConfig(
  onToolsChanged?: (tools: string[]) => void
): Promise<MCPServerStatus[]> {
  const host = getMCPHost();
  const configs = host.readServersFromConfig();
  if (configs.length === 0) return [];
  await host.connect(configs);
  if (onToolsChanged) {
    host.onNotification((_server, notif) => {
      if (notif.method === "notifications/tools/list_changed") {
        onToolsChanged(host.registeredTools());
      }
    });
  }
  return host.status() as MCPServerStatus[];
}

export async function connectMCPServer(
  config: MCPServerConfig
): Promise<MCPServerStatus> {
  const host = getMCPHost();
  await host.connect([config]);
  return host.status(config.name) as MCPServerStatus;
}

export async function disconnectMCPServer(name?: string): Promise<void> {
  const host = getMCPHost();
  await host.disconnect(name);
}

export async function initDynamicSkills(workspacePath: string): Promise<void> {
  const dynamicTools = await loadDynamicSkills(workspacePath);
  for (const [name, tool] of Object.entries(dynamicTools)) {
    TOOLS[name] = tool;
  }

  const globalSkillsDir = path.join(os.homedir(), ".pandaclaw");
  const globalTools = await loadDynamicSkills(globalSkillsDir);
  for (const [name, tool] of Object.entries(globalTools)) {
    TOOLS[name] = tool;
  }
}

export interface ToolRunResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolRunResult> {
  const tool = TOOLS[name];
  if (!tool) {
    return { success: false, error: `Unknown tool: "${name}"` };
  }

  const platform = context.channel ?? "cli";
  const decision = await getGuard().check(name, platform, context.requestConsent);

  if (!decision.allowed) {
    return { success: false, error: decision.reason ?? "Blocked by security policy" };
  }

  try {
    const data = await tool.execute(args, context);
    return { success: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}


