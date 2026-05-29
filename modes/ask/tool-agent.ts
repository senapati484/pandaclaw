// modes/ask/tool-agent.ts
// Agentic LLM loop with real tool use (file_read, file_write, list_dir, code_exec, web_search)
// All paths are resolved dynamically — no hardcoded usernames or device paths.

import os from "os";
import path from "path";
import type { PandaConfig } from "../../ai/ai.config.js";
import type { ToolContext } from "../agent/types.js";
import { TOOLS, runTool } from "../../tools/index.js";

export interface ToolAgentResult {
  answer: string;
  toolsUsed: string[];
  durationMs: number;
}

// ── OpenAI-compatible tool schema for the LLM ─────────────────────────────
const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "file_read",
      description: "Read the contents of ANY file anywhere on the device. Use absolute paths like /Users/sayansenapati/Desktop/file.txt or relative paths.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative path to the file anywhere on the device." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_write",
      description: "Write or create a file ANYWHERE on the device. Creates parent directories automatically. Use absolute paths.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative path to the file to write anywhere on the device." },
          content: { type: "string", description: "Full content to write to the file." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and folders at ANY directory on the device. Use absolute paths like /Users/sayansenapati/Desktop.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the directory. E.g. /Users/sayansenapati/Desktop or /" },
          recursive: { type: "boolean", description: "Whether to list recursively (default false)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_exec",
      description: "Execute any shell command on the device and return its output. Full system access — use bash commands like ls, cat, mkdir, echo, pwd, etc.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Shell command to run. E.g. 'echo hello > /Users/sayansenapati/Desktop/test.txt' or 'ls /Users/sayansenapati'" },
          timeout: { type: "number", description: "Timeout in milliseconds (default 15000)." },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web and return relevant results.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
        },
        required: ["query"],
      },
    },
  },
];

/** Build the system prompt dynamically from the current device's OS info — no hardcoding. */
function buildSystemPrompt(): string {
  const home     = os.homedir();                        // e.g. /Users/sayansenapati  or  /home/ubuntu
  const username = os.userInfo().username;              // e.g. sayansenapati
  const platform = os.platform();                       // darwin | linux | win32
  const hostname = os.hostname();                       // e.g. Sayans-MacBook-Air
  const cwd      = process.cwd();                       // pandaclaw working dir

  // Common locations that exist on this specific machine
  const desktop   = path.join(home, "Desktop");
  const downloads = path.join(home, "Downloads");
  const documents = path.join(home, "Documents");

  const platformNote =
    platform === "win32"
      ? `This is a Windows machine. Use Windows-style paths (e.g. C:\\Users\\${username}\\Desktop).`
      : `This is a ${platform === "darwin" ? "macOS" : "Linux"} machine.`;

  return `You are PandaClaw, a powerful AI agent running locally on ${hostname}.
You have FULL, UNRESTRICTED access to the ENTIRE device — every file, folder, and command.

${platformNote}
Username : ${username}
Home dir : ${home}
CWD      : ${cwd}

Common locations on this device:
  Desktop   → ${desktop}
  Downloads → ${downloads}
  Documents → ${documents}
  Pandaclaw → ${cwd}

Your tools work with ANY path on this device:
  file_read  → read any file anywhere (use absolute paths)
  file_write → create or edit any file anywhere (auto-creates parent dirs)
  list_dir   → browse any folder — pass absolute path like ${home}
  code_exec  → run any shell command with full system access
  web_search → search the internet

RULES:
- NEVER say "I can't access files" — you ALWAYS can via your tools.
- ALWAYS use tools for file/folder tasks. Never just describe how to do it.
- For "append" requests: file_read first, then file_write the combined content.
- Always use ABSOLUTE paths (starting with ${platform === "win32" ? "C:\\" : "/"}).
- After every tool action confirm what you did in 1-2 sentences.`;
}

// ── Call the LLM with tool schemas ────────────────────────────────────────
async function callWithTools(
  config: PandaConfig,
  messages: any[]
): Promise<any> {
  // Try Groq first (fast), then OpenRouter, then NIM
  const providers = [
    {
      name: "groq",
      base: config.providers.groq.api_base,
      key: config.providers.groq.api_key,
      model: config.routing.fast_path.model,
      headers: {},
    },
    {
      name: "openrouter",
      base: config.providers.openrouter.api_base,
      key: config.providers.openrouter.api_key,
      model: "deepseek/deepseek-chat-v3-0324:free",
      headers: {
        "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
        "X-Title": "PandaClaw",
      },
    },
    {
      name: "nvidia_nim",
      base: config.providers.nvidia_nim.api_base,
      key: config.providers.nvidia_nim.api_key,
      model: "nvidia/llama-3.1-nemotron-70b-instruct",
      headers: {},
    },
  ];

  let lastErr: Error | null = null;

  for (const p of providers) {
    if (!p.key) continue;
    try {
      const res = await fetch(`${p.base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${p.key}`,
          ...p.headers,
        },
        body: JSON.stringify({
          model: p.model,
          messages,
          tools: TOOL_SCHEMAS,
          tool_choice: "auto",
          temperature: 0.1,
          max_tokens: 4096,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        const err = new Error(`${p.name} HTTP ${res.status}: ${txt}`) as any;
        err.status = res.status;
        throw err;
      }

      const data = await res.json() as any;
      return { data, provider: p.name };
    } catch (err: any) {
      lastErr = err;
      continue; // try next provider
    }
  }

  throw lastErr ?? new Error("All providers failed");
}

// ── Main agentic loop ─────────────────────────────────────────────────────
export async function runToolAgent(
  userMessage: string,
  config: PandaConfig,
  ctx: ToolContext
): Promise<ToolAgentResult> {
  const start = Date.now();
  const toolsUsed: string[] = [];

  const messages: any[] = [
    { role: "system", content: buildSystemPrompt() },  // built fresh per-call
    { role: "user", content: userMessage },
  ];

  const MAX_ITERATIONS = 8;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const { data } = await callWithTools(config, messages);
    const choice = data.choices?.[0];
    const msg = choice?.message;

    if (!msg) throw new Error("No message in LLM response");

    // Add assistant turn to history
    messages.push(msg);

    // If the model wants to call tools
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const toolName: string = tc.function?.name ?? "";
        let toolArgs: Record<string, unknown> = {};

        try {
          toolArgs = JSON.parse(tc.function?.arguments ?? "{}");
        } catch {
          toolArgs = {};
        }

        toolsUsed.push(toolName);

        // Run the tool
        const result = await runTool(toolName, toolArgs, ctx);

        // Add tool result back to messages
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.success
            ? JSON.stringify(result.data)
            : `ERROR: ${result.error}`,
        });
      }

      // Continue loop — LLM will now process the tool results
      continue;
    }

    // No tool calls → final answer
    const answer = msg.content ?? "(no response)";
    return {
      answer,
      toolsUsed,
      durationMs: Date.now() - start,
    };
  }

  return {
    answer: "I reached the maximum number of steps. Here is what I was able to do so far. Please ask again if needed.",
    toolsUsed,
    durationMs: Date.now() - start,
  };
}
