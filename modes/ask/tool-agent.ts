// modes/ask/tool-agent.ts
// Agentic LLM loop with real tool use (file_read, file_write, list_dir, code_exec, web_search)
// Used by the Telegram gateway so the bot can actually touch files on the host machine.

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
      description: "Read the contents of a file on the local machine.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative or absolute path to the file." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_write",
      description: "Write or create a file on the local machine with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to write." },
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
      description: "List files and directories at a given path on the local machine.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to list. Defaults to current directory." },
          recursive: { type: "boolean", description: "Whether to list recursively." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_exec",
      description: "Execute a shell command or script on the local machine and return output.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Shell command or TypeScript/JS code to execute." },
          timeout: { type: "number", description: "Timeout in milliseconds (default 10000)." },
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

const SYSTEM_PROMPT = `You are PandaClaw, a powerful AI agent running locally on the user's machine.
You have DIRECT access to their filesystem and can read files, write files, list directories, run code, and search the web.
You are NOT a generic language model — you are an agent with real tools.

When the user asks you to:
- Read a file → use file_read
- Write/create/append to a file → use file_write  
- List files or explore the machine → use list_dir
- Run a command or execute code → use code_exec
- Search for something online → use web_search

Always use your tools to fulfill the request. Don't say "I can't access files" — you CAN.
After completing a tool action, report what you did clearly and concisely.
The workspace path is the directory where pandaclaw is running (process.cwd()).`;

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
    { role: "system", content: SYSTEM_PROMPT },
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
