// modes/ask/tool-agent.ts
// Agentic LLM loop with real tool use (file_read, file_write, list_dir, code_exec, web_search, alarm_set, memory_recall)
// All paths are resolved dynamically — no hardcoded usernames or device paths.

import os from "os";
import path from "path";
import type { PandaConfig } from "../../ai/ai.config.js";
import type { ToolContext } from "../agent/types.js";
import { TOOLS, runTool } from "../../tools/index.js";
import { NIM_MODELS } from "../../ai/providers/nvidia-nim.js";
import { compressJson } from "../../ai/context-compressor.js";
import {
  saveToMemory,
  loadMemory,
  recallRelevant,
  saveChatMessage,
  loadChatHistory,
  recallRelevantRelations
} from "../../memory/store.js";

export interface ToolAgentResult {
  answer: string;
  toolsUsed: string[];
  durationMs: number;
}

// ── Persistent per-chat conversation history ──────────────────────────────
const MAX_HISTORY = 10; // Keep last 10 turns per chat in prompt context

function getChatHistory(chatId: string): Array<{ role: "user" | "assistant"; content: string }> {
  return loadChatHistory(chatId, MAX_HISTORY);
}

function pushChatHistory(chatId: string, role: "user" | "assistant", content: string): void {
  saveChatMessage(chatId, role, content);
}

// ── OpenAI-compatible tool schema for the LLM ─────────────────────────────
const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "file_read",
      description: "Read the contents of ANY file anywhere on the device. Use absolute paths.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file." },
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
          path: { type: "string", description: "Absolute path to the file to write." },
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
      description: "List files and folders at ANY directory on the device.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the directory." },
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
      description: "Execute any shell command on the device and return its output. Full system access — use bash commands like ls, cat, mkdir, echo, pwd, python3, bun, etc.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Shell command to run." },
          timeout: { type: "number", description: "Timeout in milliseconds (default 30000)." },
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
  {
    type: "function",
    function: {
      name: "alarm_set",
      description: "Set an alarm, reminder or notification at a specific time or after a delay. Works on macOS. Use this for 'set alarm for 5pm', 'remind me in 10 minutes', 'alert me at 3:30pm', etc.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The alarm message or reminder text to display." },
          time: { type: "string", description: "Time to trigger: either HH:MM (24h, e.g. '17:00') for a specific clock time, or a delay like '10m', '30s', '1h'." },
        },
        required: ["message", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_recall",
      description: "Recall past conversations and facts from memory. Use when the user says 'do you remember', 'what did I say', 'last time', etc.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to recall from memory." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "app_control",
      description: "Control native applications, settings, background services, browsers, and simulated user inputs on the user's macOS device.",
      parameters: {
        type: "object",
        properties: {
          app: {
            type: "string",
            enum: ["chrome", "safari", "youtube", "system", "browser_action", "keyboard"],
            description: "The application or capability context to trigger."
          },
          action: {
            type: "string",
            enum: [
              "open_url", "search", "resolve_latest", 
              "vscode", "service", "volume", "brightness", "clipboard",
              "scroll", "navigate", "list_tabs", "switch_tab",
              "type", "press_key"
            ],
            description: "The action to perform."
          },
          url: { type: "string", description: "URL to open (required for Chrome/Safari open_url)." },
          query: { type: "string", description: "Search query (required for Chrome search)." },
          channel: { type: "string", description: "YouTube channel name to get the latest video for (required for YouTube resolve_latest)." },
          folder: { type: "string", description: "Folder path (required for system vscode action)." },
          service: { type: "string", description: "Service name, e.g. 'ollama' (required for system service action)." },
          state: { type: "string", enum: ["start", "stop"], description: "Service state (required for system service action)." },
          value: { type: "number", description: "Settings value, percentage 0 to 100 (required for system volume and brightness actions)." },
          subAction: { type: "string", enum: ["read", "write"], description: "Clipboard action (required for system clipboard action)." },
          text: { type: "string", description: "Keystroke string or clipboard text (required for keyboard type and clipboard write actions)." },
          browser: { type: "string", enum: ["chrome", "safari"], description: "Target browser (optional, defaults to 'chrome' for browser_actions)." },
          direction: { type: "string", enum: ["up", "down", "top", "bottom"], description: "Scroll direction (required for browser_action scroll)." },
          navigateAction: { type: "string", enum: ["back", "forward", "refresh", "close_tab"], description: "Navigation action (required for browser_action navigate)." },
          target: { type: "string", description: "Switch tab index or title match segment (required for browser_action switch_tab)." },
          key: { type: "string", description: "Simulated key name, e.g. 'return', 'tab', 'escape', 'space', 'up', 'down', 'c', 'v' (required for keyboard press_key)." },
          modifiers: {
            type: "array",
            items: { type: "string", enum: ["command", "option", "control", "shift", "cmd", "alt", "ctrl"] },
            description: "Simulated modifier keys (optional for keyboard press_key)."
          }
        },
        required: ["app", "action"]
      }
    }
  }
];

/** Build the system prompt dynamically from the current device's OS info — no hardcoding. */
function buildSystemPrompt(memoryContext: string): string {
  const home     = os.homedir();
  const username = os.userInfo().username;
  const platform = os.platform();
  const hostname = os.hostname();
  const cwd      = process.cwd();

  const desktop   = path.join(home, "Desktop");
  const downloads = path.join(home, "Downloads");
  const documents = path.join(home, "Documents");

  const platformNote =
    platform === "win32"
      ? `This is a Windows machine. Use Windows-style paths (e.g. C:\\Users\\${username}\\Desktop).`
      : `This is a ${platform === "darwin" ? "macOS" : "Linux"} machine.`;

  // Current time for alarm awareness
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return `You are PandaClaw, a powerful AI agent running locally on ${hostname}.
You have FULL, UNRESTRICTED access to the ENTIRE device — every file, folder, and command.

${platformNote}
Username : ${username}
Home dir : ${home}
CWD      : ${cwd}
Now      : ${timeStr} on ${dateStr}

Common locations on this device:
  Desktop   → ${desktop}
  Downloads → ${downloads}
  Documents → ${documents}
  Pandaclaw → ${cwd}

Your tools:
  file_read    → read any file anywhere (use absolute paths)
  file_write   → create or edit any file anywhere (auto-creates parent dirs)
  list_dir     → browse any folder
  code_exec    → run any shell command (python3, bun, git, etc.)
  web_search   → search the internet
  alarm_set    → set alarms and reminders (macOS native notification or terminal bell)
  memory_recall→ recall past conversations
  app_control  → control native applications, services (VS Code, Ollama), settings (volume, brightness), clipboards, browsers, and simulated keyboard inputs on this macOS device

CRITICAL RULES — follow these EXACTLY:
1. ALWAYS use tools for file/folder/code tasks. NEVER just describe — always DO it.
2. When user says "write code to desktop" → use file_write to save the file, then use code_exec to run it.
3. When user says "set alarm for 5pm" → use alarm_set tool immediately.
4. When user asks about past conversations → use memory_recall first.
5. ALWAYS use ABSOLUTE paths (starting with /).
6. After every tool action, confirm what you did in 1-2 sentences.
7. NEVER override git user.name/email — no -c user.name flags unless asked.
8. Do NOT just show code to the user — actually create/run it using tools.
9. To open a YouTube channel's latest video, ALWAYS use app_control with app='youtube', action='resolve_latest' first, then open the resolved URL with app='chrome' (or safari).
10. To control macOS system services or accessories:
    - Load a folder in VS Code: Use app='system', action='vscode', folder='/absolute/path/to/folder'.
    - Manage services: Use app='system', action='service', service='ollama', state='start' (or 'stop').
    - Control system volume/brightness: Use app='system', action='volume' (or 'brightness'), value=NUMBER.
    - Focus/Switch tab: Use app='browser_action', action='switch_tab', target='Tab Name or Index' (in browser 'chrome' or 'safari').
    - Simulate keys or keystrokes: Use app='keyboard', action='type' (or 'press_key') with text/key/modifiers parameters.

${memoryContext ? `\n📚 RELEVANT MEMORY (use this context):\n${memoryContext}` : ""}`;
}

// ── Provider chain for tool calling ──────────────────────────────────────
const TOOL_PROVIDERS = (config: PandaConfig) => [
  {
    name: "groq_70b",
    base: config.providers.groq.api_base,
    key:  config.providers.groq.api_key,
    model: "llama-3.3-70b-versatile",
    headers: {} as Record<string, string>,
    withTools: true,
  },
  {
    name: "groq_8b",
    base: config.providers.groq.api_base,
    key:  config.providers.groq.api_key,
    model: "llama-3.1-8b-instant",
    headers: {} as Record<string, string>,
    withTools: true,
  },
  {
    name: "openrouter",
    base: config.providers.openrouter.api_base,
    key:  config.providers.openrouter.api_key,
    model: "openrouter/free",
    headers: {
      "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
      "X-Title": "PandaClaw",
    } as Record<string, string>,
    withTools: true,
  },
  {
    name: "nvidia_nim",
    base: config.providers.nvidia_nim.api_base,
    key:  config.providers.nvidia_nim.api_key,
    model: NIM_MODELS.chat_large,
    headers: {} as Record<string, string>,
    withTools: false,
  },
];


async function callWithTools(
  config: PandaConfig,
  messages: any[]
): Promise<any> {
  let lastErr: Error | null = null;

  for (const p of TOOL_PROVIDERS(config)) {
    if (!p.key) continue;
    
    const controller = new AbortController();
    // 30-second timeout — Groq tool-use calls can take 5-15 seconds
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      const body: Record<string, unknown> = {
        model: p.model,
        messages,
        temperature: 0.1,
        max_tokens: 4096,
      };

      if (p.withTools) {
        body.tools = TOOL_SCHEMAS;
        body.tool_choice = "auto";
      }

      const res = await fetch(`${p.base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${p.key}`,
          ...p.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${p.name} HTTP ${res.status}: ${txt}`);
      }

      const data = await res.json() as any;
      return { data, provider: p.name, hadTools: p.withTools };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === "AbortError";
      const errMsg = isTimeout ? "Request timed out after 30s" : err.message;
      console.error(`[tool-agent] ${p.name} failed: ${errMsg?.slice(0, 120)}`);
      lastErr = isTimeout ? new Error(`${p.name} timed out`) : err;
      continue;
    }
  }

  throw lastErr ?? new Error("All providers failed for tool agent");
}

// ── Built-in tool handlers ────────────────────────────────────────────────

async function handleAlarmSet(args: Record<string, unknown>): Promise<{ success: boolean; output: string }> {
  const message = String(args.message ?? "PandaClaw Reminder");
  const timeStr = String(args.time ?? "");

  const platform = os.platform();
  let delayMs = 0;

  // Parse delay format: "10m", "30s", "1h"
  const delayMatch = timeStr.match(/^(\d+)(s|m|h)$/i);
  if (delayMatch) {
    const val = parseInt(delayMatch[1]!);
    const unit = delayMatch[2]!.toLowerCase();
    delayMs = unit === "s" ? val * 1000 : unit === "m" ? val * 60_000 : val * 3_600_000;
  } else {
    // Parse clock time: "17:00", "5:00 PM", "5pm", "17:30"
    const now = new Date();
    let targetHour = -1;
    let targetMin = 0;

    // "5pm", "5am"
    const ampmSimple = timeStr.match(/^(\d{1,2})(am|pm)$/i);
    // "5:30pm", "17:30"
    const fullTime = timeStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);

    if (ampmSimple) {
      let h = parseInt(ampmSimple[1]!);
      const period = ampmSimple[2]!.toLowerCase();
      if (period === "pm" && h !== 12) h += 12;
      if (period === "am" && h === 12) h = 0;
      targetHour = h;
      targetMin = 0;
    } else if (fullTime) {
      let h = parseInt(fullTime[1]!);
      const m = parseInt(fullTime[2]!);
      const period = fullTime[3]?.toLowerCase();
      if (period === "pm" && h !== 12) h += 12;
      if (period === "am" && h === 12) h = 0;
      targetHour = h;
      targetMin = m;
    }

    if (targetHour >= 0) {
      const target = new Date(now);
      target.setHours(targetHour, targetMin, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1); // next day if past
      delayMs = target.getTime() - now.getTime();
    } else {
      return { success: false, output: `Could not parse time: "${timeStr}". Try "5pm", "17:00", "10m", or "30s".` };
    }
  }

  const delayMin = Math.round(delayMs / 60_000);
  const delayDisplay = delayMs < 60_000
    ? `${Math.round(delayMs / 1000)} seconds`
    : delayMin < 60 ? `${delayMin} minutes` : `${Math.round(delayMin / 60)} hours`;

  // Schedule the alarm using setTimeout + native notification
  setTimeout(async () => {
    try {
      if (platform === "darwin") {
        // macOS: use osascript to show a system notification
        const { spawnSync } = await import("child_process");
        spawnSync("osascript", [
          "-e",
          `display notification "${message}" with title "🐼 PandaClaw Alarm" sound name "Glass"`,
        ]);
        // Also say it aloud
        spawnSync("say", [`PandaClaw alarm: ${message}`]);
      } else {
        // Linux: use notify-send or terminal bell
        const { spawnSync } = await import("child_process");
        try { spawnSync("notify-send", ["🐼 PandaClaw Alarm", message]); } catch {}
        process.stdout.write("\x07"); // terminal bell
      }
      console.log(`\n🔔 [ALARM FIRED] ${message}\n`);
    } catch {}
  }, delayMs);

  return {
    success: true,
    output: `✅ Alarm set! "${message}" will trigger in ${delayDisplay}.`,
  };
}

async function handleMemoryRecall(args: Record<string, unknown>): Promise<{ success: boolean; output: string }> {
  const query = String(args.query ?? "");
  try {
    const graphFacts = recallRelevantRelations(query, 5);
    const memory = loadMemory();
    const all = [...memory.recentEntries, ...memory.longTermFacts];
    const relevant = recallRelevant(query, all, 5);

    let output = "";
    if (graphFacts.length > 0) {
      output += "🐼 Knowledge Graph Facts:\n" + graphFacts.join("\n") + "\n\n";
    }

    if (relevant.length > 0) {
      output += "📝 Historical Logs:\n" + relevant
        .map((e) => `[${new Date(e.timestamp).toLocaleString()}] ${e.role}: ${e.content.slice(0, 200)}`)
        .join("\n---\n");
    }

    if (!output) {
      return { success: true, output: "No relevant memories found." };
    }

    return { success: true, output };
  } catch {
    return { success: false, output: "Failed to recall memory." };
  }
}

// ── Main agentic loop ─────────────────────────────────────────────────────
export async function runToolAgent(
  userMessage: string,
  config: PandaConfig,
  ctx: ToolContext
): Promise<ToolAgentResult> {
  const start = Date.now();
  const toolsUsed: string[] = [];
  const chatId = ctx.userId ?? "default";

  // Load relevant memory for context
  let memoryContext = "";
  try {
    const graphFacts = recallRelevantRelations(userMessage, 4);
    const memory = loadMemory();
    const all = [...memory.recentEntries, ...memory.longTermFacts];
    const relevant = recallRelevant(userMessage, all, 3);

    const list = [...graphFacts];
    if (relevant.length > 0) {
      list.push(...relevant.map((e) => `• ${e.role}: ${e.content.slice(0, 150)}`));
    }
    if (list.length > 0) {
      memoryContext = list.join("\n");
    }
  } catch {}

  // Build messages: system prompt + per-chat history + current message
  const chatHistory = getChatHistory(chatId);
  const messages: any[] = [
    { role: "system", content: buildSystemPrompt(memoryContext) },
    ...chatHistory,
    { role: "user", content: userMessage },
  ];

  // Save user message to per-chat history
  pushChatHistory(chatId, "user", userMessage);

  const MAX_ITERATIONS = 10;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const { data, hadTools } = await callWithTools(config, messages);
    const choice = data.choices?.[0];
    const msg = choice?.message;

    if (!msg) throw new Error("No message in LLM response");

    // Add assistant turn to history
    messages.push(msg);

    // Handle tool calls
    if (hadTools && msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const toolName: string = tc.function?.name ?? "";
        let toolArgs: Record<string, unknown> = {};

        try {
          toolArgs = JSON.parse(tc.function?.arguments ?? "{}");
        } catch {
          toolArgs = {};
        }

        toolsUsed.push(toolName);

        let toolResult: { success?: boolean; output?: string; data?: unknown; error?: string };

        // Handle built-in tools
        if (toolName === "alarm_set") {
          toolResult = await handleAlarmSet(toolArgs);
        } else if (toolName === "memory_recall") {
          toolResult = await handleMemoryRecall(toolArgs);
        } else {
          // Run standard tools (file_read, file_write, list_dir, code_exec, web_search)
          const result = await runTool(toolName, toolArgs, ctx);
          toolResult = result.success
            ? { output: compressJson(result.data) }
            : { error: result.error };
        }

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult.error
            ? `ERROR: ${toolResult.error}`
            : compressJson(toolResult.output ?? toolResult),
        });
      }

      continue;
    }

    // Final answer
    const answer = msg.content ?? "(no response)";

    // Save to per-chat history (trim to content only for history)
    pushChatHistory(chatId, "assistant", answer);

    // Persist to memory store
    try {
      saveToMemory({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        role: "user",
        content: userMessage,
        importance: toolsUsed.length > 0 ? "high" : "low",
      });
      saveToMemory({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        role: "assistant",
        content: answer.slice(0, 500), // Save summary
        importance: toolsUsed.length > 0 ? "high" : "low",
      });
    } catch {}

    return {
      answer,
      toolsUsed,
      durationMs: Date.now() - start,
    };
  }

  return {
    answer: "I reached the maximum number of steps. Please ask again if something is missing.",
    toolsUsed,
    durationMs: Date.now() - start,
  };
}
