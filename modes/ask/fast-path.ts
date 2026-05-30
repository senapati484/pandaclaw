// modes/ask/fast-path.ts
// Fast-path LLM call — Groq → OpenRouter → NIM (mistral-large-3)

import os from "os";
import path from "path";
import type { AskTask, AskResult } from "../../modes/agent/types.js";
import type { PandaConfig } from "../../ai/ai.config.js";
import { NIM_MODELS } from "../../ai/providers/nvidia-nim.js";

interface LLMResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { total_tokens: number };
}

/**
 * Build a concise, device-aware system prompt for the fast path.
 */
function buildFastPathSystemPrompt(): string {
  const home     = os.homedir();
  const username = os.userInfo().username;
  const platform = os.platform();
  const hostname = os.hostname();
  const cwd      = process.cwd();

  const platformNote =
    platform === "win32"
      ? `The user's device is a Windows machine. Use Windows paths (e.g. C:\\Users\\${username}\\Desktop) and Windows commands.`
      : `The user's device is a ${platform === "darwin" ? "macOS" : "Linux"} machine. Use Unix paths and terminal commands.`;

  return `You are PandaClaw, a helpful, concise AI assistant running locally on the user's device.
You have access to the device details below:
- OS Platform: ${platform} (${platformNote})
- Username: ${username}
- Home Directory: ${home}
- Hostname: ${hostname}
- Current Working Directory: ${cwd}

CRITICAL RULES:
1. Always be specific to the user's operating system (${platform}). Do not give generic Windows/macOS/Linux instructions. Only mention the steps or commands for the user's active platform (${platform}).
2. Keep your answers brief, accurate, and direct.`;
}

/**
 * Attempt a chat-completions call against one provider.
 * Returns null if the provider has no API key configured.
 * Throws on non-429 errors so callers can decide whether to keep falling back.
 */
async function tryProvider(
  apiBase: string,
  apiKey: string,
  model: string,
  messages: any[],
  maxTokens: number,
  temperature: number,
  extraHeaders: Record<string, string> = {}
): Promise<{ data: LLMResponse; provider: string } | null> {
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second timeout for fast path

  try {
    const res = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      // Surface a structured error so callers can distinguish 429 from fatal errors
      const err = new Error(`HTTP ${res.status}: ${errText}`) as any;
      err.status = res.status;
      throw err;
    }

    return { data: (await res.json()) as LLMResponse, provider: apiBase };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === "AbortError";
    const errMsg = isTimeout ? "Request timed out after 5000ms" : err.message;
    throw new Error(errMsg);
  }
}

export async function runFastPath(
  task: AskTask,
  config: PandaConfig
): Promise<AskResult> {
  const start = Date.now();

  const messages = [
    {
      role: "system",
      content: buildFastPathSystemPrompt(),
    },
    // Include last 6 messages (3 exchanges) for context
    ...task.conversationHistory.slice(-6),
    { role: "user", content: task.input },
  ];

  const { maxTokens, temperature } = config.routing.fast_path;

  // ── Provider fallback chain ──
  // 1. Groq (fast_path primary)
  // 2. OpenRouter with a free/cheap model
  // 3. Nvidia NIM
  const chain: Array<() => Promise<{ data: LLMResponse; provider: string } | null>> = [
    // ── Groq 70B — primary, best quality ──────────────────────────────────
    () =>
      tryProvider(
        config.providers.groq.api_base,
        config.providers.groq.api_key,
        config.routing.fast_path.model,   // llama-3.3-70b-versatile
        messages,
        maxTokens,
        temperature
      ),
    // ── Groq 8B — fast fallback, separate rate-limit bucket ───────────────
    () =>
      tryProvider(
        config.providers.groq.api_base,
        config.providers.groq.api_key,
        "llama-3.1-8b-instant",
        messages,
        maxTokens,
        temperature
      ),
    // ── OpenRouter — if both Groq buckets are exhausted ───────────────────
    () =>
      tryProvider(
        config.providers.openrouter.api_base,
        config.providers.openrouter.api_key,
        "openrouter/free",
        messages,
        maxTokens,
        temperature,
        {
          "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
          "X-Title": "PandaClaw",
        }
      ),
    // ── NIM — last resort ─────────────────────────────────────────────────
    () =>
      tryProvider(
        config.providers.nvidia_nim.api_base,
        config.providers.nvidia_nim.api_key,
        NIM_MODELS.chat_large,   // mistralai/mistral-large-3-675b-instruct-2512
        messages,
        maxTokens,
        temperature
      ),
  ];

  let lastError: Error | null = null;
  let usedProvider = "groq";

  for (const attempt of chain) {
    try {
      const result = await attempt();
      if (!result) continue; // No API key — skip

      const { data } = result;
      const answer = data.choices[0]?.message?.content ?? "(no response)";
      const providerLabel = result.provider.includes("groq")
        ? "groq"
        : result.provider.includes("openrouter")
        ? "openrouter"
        : "nvidia_nim";

      return {
        answer,
        taskType: "simple",
        tokensUsed: data.usage?.total_tokens ?? 0,
        provider: providerLabel,
        durationMs: Date.now() - start,
        verified: false,
      };
    } catch (err: any) {
      lastError = err;
      // 429 = rate limit → try next provider
      // 401 = bad key → try next provider
      // 5xx = server error → try next provider
      // Any other error → keep trying
      continue;
    }
  }

  // All providers failed
  throw lastError ?? new Error("All LLM providers failed. Check your API keys in config.json.");
}
