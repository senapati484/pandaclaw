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
  recallRelevantRelations,
  pruneAndCompactChats
} from "../../memory/store.js";
import { sanitizeMessages, fetchWithRetry } from "../../ai/llm.js";

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
  },
  {
    type: "function",
    function: {
      name: "canvas_control",
      description: "Control the Visual Canvas dashboard. Draw shapes or display custom HTML elements/layout blocks.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["draw_rect", "render_html", "clear_canvas"], description: "The visual action to dispatch." },
          x: { type: "number", description: "X coordinate (for draw_rect)." },
          y: { type: "number", description: "Y coordinate (for draw_rect)." },
          width: { type: "number", description: "Width of rectangle or HTML container." },
          height: { type: "number", description: "Height of rectangle." },
          color: { type: "string", description: "CSS stroke color, e.g. '#5b4d9e' (optional)." },
          lineWidth: { type: "number", description: "Stroke line width (optional)." },
          label: { type: "string", description: "Text label to display inside/next to the shape (optional)." },
          html: { type: "string", description: "HTML layout block to render inside the dashboard viewport (required for render_html)." },
          clearFirst: { type: "boolean", description: "Whether to clear previous HTML cards first (optional, defaults to false)." }
        },
        required: ["action"]
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
  alarm_set    → set alarms and reminders
  memory_recall→ recall past conversations
  app_control  → control apps, browsers, system settings
  canvas_control→ control the Visual Canvas dashboard

══════════════════════════════════════════════════
⚠️  MANDATORY BEHAVIOR — NEVER VIOLATE THESE:
══════════════════════════════════════════════════

🚫 FORBIDDEN — You MUST NEVER:
  - Tell the user to "open Terminal and run nano/vim/cat"
  - Tell the user to "open the file explorer"
  - Give manual step-by-step instructions for things tools can do
  - Say "I can't directly edit files" — YOU CAN. Use file_write.
  - Say "you'll need to" or "you can" — DO IT YOURSELF with tools.
  - Use hardcoded paths like /home/ubuntu, /Users/someuser, C:\\Users\\user — ALWAYS use the dynamic paths shown above (Desktop → ${desktop}, Downloads → ${downloads}, etc.)

✅ REQUIRED — You MUST ALWAYS:
  1. USE TOOLS for ANY file/folder/code task. Act, don't instruct.
  2. To EDIT a file:
       a. FIRST call file_read to get the current content
       b. THEN call file_write with the complete modified content
     ✗ WRONG: "To edit the file, open Terminal and run: nano /path/to/file"
     ✓ RIGHT: Call file_read("/path/to/file") → modify content → call file_write("/path/to/file", newContent)
  3. To DELETE a file: use code_exec with "rm /absolute/path" (macOS/Linux) or "del C:\\path" (Windows)
  4. To RUN code: use code_exec — don't show the command, execute it.
  5. Use ABSOLUTE paths always (starting with /).
  6. After every tool action, confirm what you did in 1–2 sentences.
  7. NEVER add -c user.name or -c user.email to git commands.
  8. To open YouTube's latest video: use app_control app='youtube' action='resolve_latest' FIRST, then open the URL with app='chrome'.
  9. For system controls (volume, brightness, VS Code, Ollama): use app_control with app='system'.
  10. For browser tab control (scroll, navigate, switch): use app_control with app='browser_action'.

══════════════════════════════════════════════════
🧑‍💻  CODE GENERATION PROTOCOL — ALWAYS FOLLOW THIS:
══════════════════════════════════════════════════

When you write ANY code file (Python, Shell, TypeScript, JavaScript, etc.), you MUST follow ALL of these rules — no exceptions:

📁 PATHS — Never hardcode. Always use dynamic values:
  - Python : use os.path.expanduser("~"), os.path.join(...), pathlib.Path.home()
  - Shell  : use "$HOME", "$USER", "$(pwd)"
  - Node   : use os.homedir(), process.cwd(), path.join(...)
  - The Desktop on this device is: ${desktop}

🛡 ROBUSTNESS — All generated code must be production-quality:
  - Python  : wrap ALL IO/network calls in try/except, handle specific exceptions not bare except
  - Shell   : start every .sh script with "set -euo pipefail" so it fails fast on any error
  - Node/Bun: use try/catch for async calls; never leave unhandled promise rejections
  - Always add a shebang line: "#!/usr/bin/env python3" (Python), "#!/usr/bin/env bash" (Shell)

📺 INTERACTIVE INPUT — stdin is NOT a TTY inside code_exec:
  - If a script uses input() (Python) or readline/prompt (Node), it WILL crash with EOFError
  - ALWAYS add a non-interactive fallback:
      Python : check sys.stdin.isatty(); catch EOFError; or use sys.argv for inputs
      Node   : check process.stdin.isTTY; or use process.argv for inputs
  - The fallback must run a self-contained demonstration so code_exec can verify the script

📦 DEPENDENCIES — Check before writing:
  - Before using a third-party Python import: run code_exec "python3 -c 'import <pkg>'" to verify it's installed
  - If not installed: run code_exec "pip3 install <pkg>" first, THEN write the script
  - For Node/Bun packages: run code_exec "bun pm ls | grep <pkg>" or "node -e \"require('<pkg>')\""

✅ WRITE → VERIFY → FIX LOOP (mandatory for all code files):
  STEP 1. file_write the code — check the returned "syntaxCheck" field immediately
  STEP 2. If syntaxCheck is "SYNTAX ERROR: ..." → file_read to inspect, fix it, file_write again — repeat until "OK"
  STEP 3. code_exec to RUN the written file — check exitCode
  STEP 4. If exitCode !== 0 → read the "hint" field in the result, apply the fix, rewrite, re-run
  STEP 5. Repeat STEP 3–4 up to 3 times
  STEP 6. Only report "done" to the user AFTER exitCode === 0

${memoryContext ? `\n📚 RELEVANT MEMORY (use this context):\n${memoryContext}` : ""}`;
}

// ── Provider chain for tool calling ──────────────────────────────────────
const TOOL_PROVIDERS = (config: PandaConfig) => [
  {
    name: "groq_70b",
    base: config.providers.groq?.api_base,
    key:  config.providers.groq?.api_key,
    model: "llama-3.3-70b-versatile",
    headers: {} as Record<string, string>,
    withTools: true,
  },
  {
    name: "groq_8b",
    base: config.providers.groq?.api_base,
    key:  config.providers.groq?.api_key,
    model: "llama-3.1-8b-instant",
    headers: {} as Record<string, string>,
    withTools: true,
  },
  {
    // Llama 3.3 70B (free) — verified on OpenRouter, 131K ctx, great tool calling
    name: "openrouter_llama",
    base: config.providers.openrouter?.api_base,
    key:  config.providers.openrouter?.api_key,
    model: "meta-llama/llama-3.3-70b-instruct:free",
    headers: {
      "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
      "X-Title": "PandaClaw",
    } as Record<string, string>,
    withTools: true,
  },
  {
    // GPT-OSS 120B (free) — OpenAI OSS model on OpenRouter, strong tool calling
    name: "openrouter_gpt_oss",
    base: config.providers.openrouter?.api_base,
    key:  config.providers.openrouter?.api_key,
    model: "openai/gpt-oss-120b:free",
    headers: {
      "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
      "X-Title": "PandaClaw",
    } as Record<string, string>,
    withTools: true,
  },
  {
    // DeepSeek V4 Flash (free) — 1M context, fast
    name: "openrouter_deepseek_flash",
    base: config.providers.openrouter?.api_base,
    key:  config.providers.openrouter?.api_key,
    model: "deepseek/deepseek-v4-flash:free",
    headers: {
      "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
      "X-Title": "PandaClaw",
    } as Record<string, string>,
    withTools: true,
  },
  {
    // OpenRouter smart free router — auto-selects best available free model
    name: "openrouter_free",
    base: config.providers.openrouter?.api_base,
    key:  config.providers.openrouter?.api_key,
    model: "openrouter/free",
    headers: {
      "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
      "X-Title": "PandaClaw",
    } as Record<string, string>,
    withTools: true,
  },
  {
    name: "nvidia_nim",
    base: config.providers.nvidia_nim?.api_base,
    key:  config.providers.nvidia_nim?.api_key,
    model: NIM_MODELS.chat_large,
    headers: {} as Record<string, string>,
    withTools: false,
  },
  {
    name: "ollama",
    base: config.providers.ollama?.api_base || "http://127.0.0.1:11434/v1",
    key:  config.providers.ollama?.api_key || "ollama",
    model: "qwen3:0.6b",
    headers: {} as Record<string, string>,
    withTools: true,
  },
];


async function callWithTools(
  config: PandaConfig,
  messages: any[]
): Promise<any> {
  let lastErr: Error | null = null;

  // Build the unified list of tools including statically defined and dynamic tools
  const allToolSchemas = [...TOOL_SCHEMAS];
  for (const [name, tool] of Object.entries(TOOLS)) {
    if (!allToolSchemas.some(s => s.function?.name === name)) {
      const toolSchema = tool.schema || {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties: {
              arguments: { type: "string", description: "Optional raw arguments or inputs for the tool." }
            }
          }
        }
      };
      allToolSchemas.push(toolSchema);
    }
  }

  for (const p of TOOL_PROVIDERS(config)) {
    if (!p.key) continue;
    
    const controller = new AbortController();
    // 10-second timeout — Groq tool-use calls can take 5-15 seconds
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const body: Record<string, unknown> = {
        model: p.model,
        messages: sanitizeMessages(messages),
        temperature: 0.1,
        max_tokens: 4096,
      };

      if (p.withTools) {
        body.tools = allToolSchemas;
        body.tool_choice = "auto";
      }

      const res = await fetchWithRetry(`${p.base}/chat/completions`, {
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
      const errMsg = isTimeout ? "Request timed out after 10s" : err.message;
      console.error(`[tool-agent] ${p.name} failed: ${errMsg?.slice(0, 120)}`);
      lastErr = isTimeout ? new Error(`${p.name} timed out after 10s`) : err;
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

    // Prune and compact oldest chat logs if history size exceeds the limit (run in background)
    pruneAndCompactChats(chatId, 12, config).catch((err) => {
      console.warn(`[compaction check] Compaction failed: ${err.message}`);
    });

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
