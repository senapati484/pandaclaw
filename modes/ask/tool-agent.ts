// modes/ask/tool-agent.ts
// Agentic LLM loop with real tool use (file_read, file_write, list_dir, code_exec, web_search, alarm_set, memory_recall)
// All paths are resolved dynamically — no hardcoded usernames or device paths.

import os from "os";
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
import { sanitizeMessages, fetchWithRetry } from "../../ai/providers/llm-utils.js";
import { TOOL_SCHEMAS } from "./tool-schemas.js";

export interface ToolAgentResult {
  answer: string;
  toolsUsed: string[];
  durationMs: number;
}

export type ProgressChunk = { type: "progress"; text: string } | { type: "text"; text: string } | { type: "done" };
export type OnChunk = (chunk: ProgressChunk) => void;

// ── Persistent per-chat conversation history ──────────────────────────────
const MAX_HISTORY = 10; // Keep last 10 turns per chat in prompt context

function getChatHistory(chatId: string): Array<{ role: "user" | "assistant"; content: string }> {
  return loadChatHistory(chatId, MAX_HISTORY);
}

function pushChatHistory(chatId: string, role: "user" | "assistant", content: string): void {
  saveChatMessage(chatId, role, content);
}


/** Build the system prompt dynamically from the current device's OS info — no hardcoding. */
function buildSystemPrompt(memoryContext: string): string {
  const home = os.homedir();
  const platform = os.platform();
  const hostname = os.hostname();
  const now = new Date().toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", year: "numeric" });
  const platformNote = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : "Linux";

  return `You are PandaClaw on ${hostname} (${platformNote}). Full device access. ${now}.

CRITICAL RULES:
- NEVER say "I don't know" — use tools.
- First check memory_recall for info you might already know. If empty, use web_search.
- NEVER give manual Terminal/file-explorer instructions. ALWAYS use your tools.
- Use ABSOLUTE paths. Home: ${home}
- To edit a file: file_read → modify → file_write.
- To run/install/delete: use code_exec.
- After each action, confirm in 1 sentence.

${memoryContext ? `\nContext:\n${memoryContext}` : ""}`;
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
    name: "openrouter_qwen3_coder",
    base: config.providers.openrouter?.api_base,
    key:  config.providers.openrouter?.api_key,
    model: "qwen/qwen3-coder:free",
    headers: { "HTTP-Referer": "https://github.com/senapati484/pandaclaw", "X-Title": "PandaClaw" } as Record<string, string>,
    withTools: true,
  },
  {
    name: "nvidia_nim",
    base: config.providers.nvidia_nim?.api_base,
    key:  config.providers.nvidia_nim?.api_key,
    model: NIM_MODELS.chat_fast,
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


// Providers too small for tool-laden agent requests (skipped silently)
const SMALL_TOOL_MODELS = new Set(["llama-3.1-8b-instant", "qwen3:0.6b"]);

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
    if (p.withTools && SMALL_TOOL_MODELS.has(p.model)) continue;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);

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
      if (err.name === "AbortError") {
        lastErr = new Error(`${p.name} timed out`);
      } else {
        lastErr = err;
      }
    }
  }

  throw lastErr ?? new Error("All providers failed for tool agent");
}

// ── Built-in tool handlers ────────────────────────────────────────────────

function parseRelativeAlarm(timeStr: string): number | null {
  const delayMatch = timeStr.match(/^(\d+)(s|m|h)$/i);
  if (!delayMatch) return null;
  const val = parseInt(delayMatch[1]!);
  const unit = delayMatch[2]!.toLowerCase();
  return unit === "s" ? val * 1000 : unit === "m" ? val * 60_000 : val * 3_600_000;
}

function parseAbsoluteAlarm(timeStr: string): number | null {
  const now = new Date();
  let targetHour = -1;
  let targetMin = 0;

  const ampmSimple = timeStr.match(/^(\d{1,2})(am|pm)$/i);
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
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }
  return null;
}

function parseAlarmTime(timeStr: string): number {
  const relative = parseRelativeAlarm(timeStr);
  if (relative !== null) return relative;

  const absolute = parseAbsoluteAlarm(timeStr);
  if (absolute !== null) return absolute;

  return -1;
}

async function triggerAlarmNotification(message: string, platform: string): Promise<void> {
  try {
    const { spawnSync } = await import("child_process");
    if (platform === "darwin") {
      // macOS: use osascript to show a system notification
      spawnSync("osascript", [
        "-e",
        `display notification "${message}" with title "🐼 PandaClaw Alarm" sound name "Glass"`,
      ]);
      // Also say it aloud
      spawnSync("say", [`PandaClaw alarm: ${message}`]);
    } else {
      // Linux: use notify-send or terminal bell
      try { spawnSync("notify-send", ["🐼 PandaClaw Alarm", message]); } catch {}
      process.stdout.write("\x07"); // terminal bell
    }
    console.log(`\n🔔 [ALARM FIRED] ${message}\n`);
  } catch {}
}

async function handleAlarmSet(args: Record<string, unknown>): Promise<{ success: boolean; output: string }> {
  const message = String(args.message ?? "PandaClaw Reminder");
  const timeStr = String(args.time ?? "");

  const platform = os.platform();
  const delayMs = parseAlarmTime(timeStr);

  if (delayMs < 0) {
    return { success: false, output: `Could not parse time: "${timeStr}". Try "5pm", "17:00", "10m", or "30s".` };
  }

  const delayMin = Math.round(delayMs / 60_000);
  const delayDisplay = delayMs < 60_000
    ? `${Math.round(delayMs / 1000)} seconds`
    : delayMin < 60 ? `${delayMin} minutes` : `${Math.round(delayMin / 60)} hours`;

  // Schedule the alarm using setTimeout + native notification
  setTimeout(async () => {
    await triggerAlarmNotification(message, platform);
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

function simulateStream(text: string, onChunk?: OnChunk): void {
  if (!onChunk) return;
  const words = text.split(" ");
  let buffer = "";
  for (const word of words) {
    buffer += (buffer ? " " : "") + word;
    if (buffer.length >= 80) {
      onChunk({ type: "text", text: buffer });
      buffer = "";
    }
  }
  if (buffer) onChunk({ type: "text", text: buffer });
}

async function executeAgentToolCall(
  tc: any,
  ctx: ToolContext,
  onChunk?: OnChunk
): Promise<{ role: "tool"; tool_call_id: string; content: string; toolName: string }> {
  const toolName: string = tc.function?.name ?? "";
  let toolArgs: Record<string, unknown> = {};

  try {
    toolArgs = JSON.parse(tc.function?.arguments ?? "{}");
  } catch {
    toolArgs = {};
  }

  const progressLabel: Record<string, string> = {
    web_search: "🔍 Searching the web",
    file_read: "📖 Reading file",
    file_write: "✏️ Writing file",
    list_dir: "📂 Listing directory",
    code_exec: "⚡ Running command",
    app_control: "🎮 Controlling app",
    canvas_control: "🎨 Updating canvas",
    memory_recall: "🧠 Recalling memory",
    alarm_set: "⏰ Setting alarm",
  };
  const progressMsg = progressLabel[toolName] || `🔧 Running ${toolName}`;
  onChunk?.({ type: "progress", text: progressMsg });

  let toolResult: { success?: boolean; output?: string; data?: unknown; error?: string };

  if (toolName === "alarm_set") {
    toolResult = await handleAlarmSet(toolArgs);
  } else if (toolName === "memory_recall") {
    toolResult = await handleMemoryRecall(toolArgs);
  } else {
    const result = await runTool(toolName, toolArgs, ctx);
    toolResult = result.success
      ? { output: compressJson(result.data) }
      : { error: result.error };
  }

  const content = toolResult.error
    ? `ERROR: ${toolResult.error}`
    : compressJson(toolResult.output ?? toolResult);

  return {
    role: "tool",
    tool_call_id: tc.id,
    content,
    toolName
  };
}

// ── Main agentic loop ─────────────────────────────────────────────────────
export async function runToolAgent(
  userMessage: string,
  config: PandaConfig,
  ctx: ToolContext,
  onChunk?: OnChunk
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
        const executed = await executeAgentToolCall(tc, ctx, onChunk);
        toolsUsed.push(executed.toolName);
        messages.push({
          role: "tool",
          tool_call_id: executed.tool_call_id,
          content: executed.content,
        });
      }

      continue;
    }

    // Final answer
    const answer = msg.content ?? "(no response)";

    // Stream final answer in chunks
    simulateStream(answer, onChunk);
    onChunk?.({ type: "done" });

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
