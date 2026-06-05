// modes/ask/fast-path.ts
// Fast-path LLM call — Groq → OpenRouter → NIM (mistral-large-3)

import os from "os";
import path from "path";
import type { AskTask, AskResult } from "../../modes/agent/types.js";
import type { PandaConfig } from "../../ai/ai.config.js";
import { NIM_MODELS } from "../../ai/providers/nvidia-nim.js";
import { sanitizeMessages, fetchWithRetry } from "../../ai/providers/llm-utils.js";

interface LLMResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: {
    total_tokens: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
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
): Promise<{ data: LLMResponse; provider: string; model: string } | null> {
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout for fast path

  try {
    const res = await fetchWithRetry(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({ model, messages: sanitizeMessages(messages), max_tokens: maxTokens, temperature }),
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

    return { data: (await res.json()) as LLMResponse, provider: apiBase, model };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === "AbortError";
    const errMsg = isTimeout ? "Request timed out after 10000ms" : err.message;
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

  const openRouterHeaders = {
    "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
    "X-Title": "PandaClaw",
  };

  const specs = [
    // ── Groq 8B instant — PRIMARY (14.4K req/day, fast, avoids rate limits) ──
    { providerName: "groq", apiBase: config.providers.groq.api_base, apiKey: config.providers.groq.api_key, model: config.routing.fast_path.model },
    // ── Groq 70B versatile — heavy fallback (1K req/day, better reasoning) ──
    { providerName: "groq", apiBase: config.providers.groq.api_base, apiKey: config.providers.groq.api_key, model: "llama-3.3-70b-versatile" },
    // ── OpenRouter Gemma 4 26B A4B MoE — ultra-fast (only 3.8B active params) ──
    { providerName: "openrouter", apiBase: config.providers.openrouter.api_base, apiKey: config.providers.openrouter.api_key, model: "google/gemma-4-26b-a4b-it:free", extraHeaders: openRouterHeaders },
    // ── OpenRouter Qwen3 Next 80B — 262K context, structured outputs ───────
    { providerName: "openrouter", apiBase: config.providers.openrouter.api_base, apiKey: config.providers.openrouter.api_key, model: "qwen/qwen3-next-80b-a3b-instruct:free", extraHeaders: openRouterHeaders },
    // ── OpenRouter Gemma 4 31B — 262K context, reasoning ──────────────────
    { providerName: "openrouter", apiBase: config.providers.openrouter.api_base, apiKey: config.providers.openrouter.api_key, model: "google/gemma-4-31b-it:free", extraHeaders: openRouterHeaders },
    // ── OpenRouter Nemotron 3 Super 120B — 1M ctx, NVIDIA reasoning ────────
    { providerName: "openrouter", apiBase: config.providers.openrouter.api_base, apiKey: config.providers.openrouter.api_key, model: "nvidia/nemotron-3-super-120b-a12b:free", extraHeaders: openRouterHeaders },
    // ── OpenRouter Qwen3 Coder 480B — 1M ctx, best free model overall ──────
    { providerName: "openrouter", apiBase: config.providers.openrouter.api_base, apiKey: config.providers.openrouter.api_key, model: "qwen/qwen3-coder:free", extraHeaders: openRouterHeaders },
    // ── OpenRouter Llama 3.3 70B — 131K ctx, battle-tested ─────────────────
    { providerName: "openrouter", apiBase: config.providers.openrouter.api_base, apiKey: config.providers.openrouter.api_key, model: "meta-llama/llama-3.3-70b-instruct:free", extraHeaders: openRouterHeaders },
    // ── NIM — cloud GPU fallback ────────────────────────────────────
    { providerName: "nvidia_nim", apiBase: config.providers.nvidia_nim.api_base, apiKey: config.providers.nvidia_nim.api_key, model: NIM_MODELS.chat_fast },
    // ── Ollama — local fallback, always available if running ────────────
    { providerName: "ollama", apiBase: config.providers.ollama?.api_base ?? "http://127.0.0.1:11434/v1", apiKey: config.providers.ollama?.api_key ?? "ollama", model: "qwen3:0.6b" }
  ];

  let lastError: Error | null = null;
  const { globalRegistry } = await import("../../ai/providers/adapter.js");

  // 1st pass: only try providers not on cooldown
  // 2nd pass: try all providers (ignore cooldowns) if 1st pass yielded nothing
  for (const ignoreCooldown of [false, true]) {
    let attemptedAny = false;

    for (const spec of specs) {
      if (!spec.apiKey) continue;

      if (!ignoreCooldown && !globalRegistry.isCooledDown(spec.providerName)) {
        continue;
      }

      attemptedAny = true;

      try {
        const result = await tryProvider(
          spec.apiBase,
          spec.apiKey,
          spec.model,
          messages,
          maxTokens,
          temperature,
          spec.extraHeaders
        );

        if (!result) continue;

        const { data } = result;
        const answer = data.choices[0]?.message?.content ?? "(no response)";
        const providerLabel = result.provider.includes("groq")
          ? "groq"
          : result.provider.includes("openrouter")
          ? "openrouter"
          : result.provider.includes("11434") || result.provider.includes("ollama")
          ? "ollama"
          : "nvidia_nim";

        // Track cost
        const finalInputTokens = data.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(messages).length / 4);
        const finalOutputTokens = data.usage?.completion_tokens ?? Math.ceil(answer.length / 4);
        const { CostTracker } = await import("../../utils/cost-tracker.js");
        CostTracker.track(result.model, finalInputTokens, finalOutputTokens);

        return {
          answer,
          taskType: "simple",
          tokensUsed: data.usage?.total_tokens ?? (finalInputTokens + finalOutputTokens),
          provider: providerLabel,
          durationMs: Date.now() - start,
          verified: false,
        };
      } catch (err: any) {
        lastError = err;
        const errMsg = err.message || "";
        const isRateLimit = err.status === 429 || 
                            err.statusCode === 429 || 
                            /429|rate limit|rate-limit/i.test(errMsg);
        if (isRateLimit) {
          let retryAfterMs = 60 * 1000; // default 1 minute
          const match = errMsg.match(/retry-after:\s*(\d+)/i);
          if (match && match[1]) {
            const secs = parseInt(match[1], 10);
            if (!isNaN(secs)) {
              retryAfterMs = secs * 1000;
            }
          }
          retryAfterMs = Math.min(retryAfterMs, 10 * 60 * 1000);
          globalRegistry.setCooldown(spec.providerName, retryAfterMs);
        }
        continue;
      }
    }

    // If we tried nothing in the first pass because everything was on cooldown,
    // we continue to the second pass where ignoreCooldown is true.
    // Otherwise, if we attempted at least one provider and it failed, we don't
    // need to run the second pass immediately, but wait—actually, we should try
    // the fallback options (second pass) if everything in the first pass failed
    // due to connection or other errors, or if we want maximum reliability.
    // Let's just run the second pass if we get to the end of the first pass.
  }

  // All providers failed
  throw lastError ?? new Error("All LLM providers failed. Check your API keys in config.json.");
}
