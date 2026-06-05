import type { PandaConfig } from "./ai.config.js";
import chalk from "chalk";
import { globalRegistry } from "./providers/adapter.js";
import type { LLMMessage } from "./providers/adapter.js";
import { GroqAdapter } from "./providers/groq-adapter.js";
import { OpenRouterAdapter } from "./providers/openrouter-adapter.js";
import { OllamaAdapter } from "./providers/ollama-adapter.js";
import { NvidiaAdapter } from "./providers/nvidia-adapter.js";
import { streamCompletion } from "./providers/stream-adapter.js";
import type { StreamChunk } from "./providers/stream-adapter.js";
import { getCache } from "./response-cache.js";

export interface LLMCallOptions {
  messages: any[];
  tools?: any[];
  tool_choice?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  onChunk?: (chunk: StreamChunk) => void;
  useCache?: boolean;
}

export function initProviders(config: PandaConfig): void {
  globalRegistry.clear();

  // Register available providers
  const providers = config.providers;

  if (providers.groq?.api_key) {
    globalRegistry.register(
      new GroqAdapter(providers.groq.api_key, providers.groq.api_base)
    );
  }

  if (providers.openrouter?.api_key) {
    globalRegistry.register(
      new OpenRouterAdapter(providers.openrouter.api_key, providers.openrouter.api_base)
    );
  }

  if (providers.nvidia_nim?.api_key) {
    globalRegistry.register(
      new NvidiaAdapter(providers.nvidia_nim.api_key, providers.nvidia_nim.api_base)
    );
  }

  if (providers.ollama?.api_base) {
    globalRegistry.register(
      new OllamaAdapter(providers.ollama.api_base)
    );
  }

  // Set fallback order from config
  if (config.routing.fallback_chain) {
    globalRegistry.setFallbackOrder(config.routing.fallback_chain);
  }
}

/**
 * Resolve provider config (apiBase, apiKey, model) from PandaConfig by provider name.
 */
function resolveProviderConfig(config: PandaConfig, providerName: string): { apiBase: string; apiKey: string; model: string } | null {
  const p = config.providers as Record<string, { api_key?: string; api_base?: string } | undefined>;
  const prov = p[providerName];
  if (!prov?.api_key && !prov?.api_base) return null;

  // Pick the first routing entry that uses this provider to get a model name
  const routing = config.routing as Record<string, { provider?: string; model?: string }>;
  let model = "";
  for (const key of Object.keys(routing)) {
    const entry = routing[key];
    if (entry?.provider === providerName && entry?.model) {
      model = entry.model;
      break;
    }
  }

  if (!model) {
    if (providerName === "groq") model = "llama-3.3-70b-versatile";
    else if (providerName === "openrouter") model = "google/gemini-2.5-flash";
    else if (providerName === "nvidia_nim") model = "meta/llama-3.1-70b-instruct";
    else if (providerName === "ollama") model = "qwen3-coder";
  }

  return {
    apiBase: prov.api_base || "",
    apiKey: prov.api_key || "",
    model,
  };
}

/**
 * Resolve the preferred provider for the fast path.
 */
function resolvePreferredProvider(config: PandaConfig): string {
  return config.routing.fast_path.provider || "groq";
}

/**
 * Build a cache key from messages — system prompt + last user message.
 */
function buildCachePrompt(messages: any[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "user") {
      parts.push(`${msg.role}: ${typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}`);
    }
  }
  return parts.join("\n");
}

/**
 * Run an async factory with an AbortController that fires after `ms` milliseconds.
 * Throws an `Error` with the message `"${label} timed out"` on timeout.
 */
async function withTimeout<T>(
  label: string,
  ms: number,
  factory: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const result = await factory(controller.signal);
    clearTimeout(id);
    return result;
  } catch (err: any) {
    clearTimeout(id);
    if (err.name === "AbortError") throw new Error(`${label} timed out`);
    throw err;
  }
}

async function callLLMStream(
  config: PandaConfig,
  options: LLMCallOptions,
  chain: any[],
  preferredProvider: string
): Promise<any> {
  let lastError: Error | null = null;
  for (const provider of chain) {
    const provConfig = resolveProviderConfig(config, provider.name);
    if (!provConfig || !provConfig.apiKey || !provConfig.apiBase) continue;

    try {
      let fullContent = "";
      const toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> = [];
      let parsedUsage: any = null;

      await withTimeout(`${provider.name} stream`, 30_000, (signal) =>
        streamCompletion(
          provConfig.apiBase.replace(/\/+$/, ""),
          provConfig.apiKey,
          provConfig.model,
          options.messages,
          (chunk) => {
            if (chunk.type === "text" && chunk.content) {
              fullContent += chunk.content;
            }
            if (chunk.usage) {
              parsedUsage = chunk.usage;
            }
            if (chunk.type === "tool_call" && chunk.toolName) {
              toolCalls.push({
                id: chunk.toolCallId || "call_" + Math.random().toString(36).substring(2, 11),
                type: "function",
                function: {
                  name: chunk.toolName,
                  arguments: chunk.toolArgs || "{}",
                },
              });
            }
            options.onChunk?.(chunk);
          },
          {
            tools: options.tools as any,
            temperature: options.temperature,
            max_tokens: options.max_tokens,
            signal,
          }
        )
      );

      const streamResponse = {
        choices: [
          {
            message: {
              role: "assistant",
              content: fullContent || null,
              tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            },
          },
        ],
        model: provConfig.model,
      };

      // Cost Guard tracking
      const finalInputTokens = parsedUsage?.prompt_tokens ?? Math.ceil(JSON.stringify(options.messages).length / 4);
      const finalOutputTokens = parsedUsage?.completion_tokens ?? Math.ceil((fullContent || "").length / 4);
      const { CostTracker } = await import("../utils/cost-tracker.js");
      CostTracker.track(provConfig.model, finalInputTokens, finalOutputTokens);

      if (options.useCache !== false && fullContent) {
        const cache = getCache();
        cache.store(buildCachePrompt(options.messages), fullContent, provConfig.model);
      }

      return streamResponse;
    } catch (err: any) {
      lastError = err;
      const errMsg = err.message || "";
      console.warn(
        chalk.yellow(`\n⚡ [callLLM] ${provider.name} streaming failed: ${errMsg.slice(0, 120)}. Trying next provider...\n`)
      );

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
        retryAfterMs = Math.min(retryAfterMs, 10 * 60 * 1000); // Max 10 minutes
        globalRegistry.setCooldown(provider.name, retryAfterMs);
      }
    }
  }

  throw lastError || new Error("All LLM providers in fallback chain failed.");
}

async function callLLMNonStream(options: LLMCallOptions, chain: any[]): Promise<any> {
  let lastError: Error | null = null;
  for (const provider of chain) {
    try {
      const result = await withTimeout<any>(`${provider.name}`, 30_000, (signal) =>
        provider.complete({
          messages: options.messages as LLMMessage[],
          tools: options.tools,
          tool_choice: options.tool_choice as any,
          temperature: options.temperature,
          max_tokens: options.max_tokens,
          signal,
        })
      );

      const nonStreamResponse = {
        choices: [
          {
            message: {
              role: "assistant",
              content: result.content,
              tool_calls: result.tool_calls,
            },
          },
        ],
        usage: result.usage,
        model: result.model,
      };

      // Cost Guard tracking
      const finalInputTokens = result.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(options.messages).length / 4);
      const finalOutputTokens = result.usage?.completion_tokens ?? Math.ceil((result.content || "").length / 4);
      const { CostTracker } = await import("../utils/cost-tracker.js");
      CostTracker.track(result.model, finalInputTokens, finalOutputTokens);

      if (options.useCache !== false && result.content) {
        const cache = getCache();
        cache.store(buildCachePrompt(options.messages), result.content, result.model);
      }

      return nonStreamResponse;
    } catch (err: any) {
      lastError = err;
      const errMsg = err.message || "";
      console.warn(
        chalk.yellow(`\n⚡ [callLLM] ${provider.name} failed: ${errMsg.slice(0, 120)}. Trying next provider...\n`)
      );

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
        retryAfterMs = Math.min(retryAfterMs, 10 * 60 * 1000); // Max 10 minutes
        globalRegistry.setCooldown(provider.name, retryAfterMs);
      }
    }
  }

  throw lastError || new Error("All LLM providers in fallback chain failed.");
}

export async function callLLM(config: PandaConfig, options: LLMCallOptions): Promise<any> {
  // Initialize providers on first call if needed
  if (globalRegistry.getAllAvailable().length === 0) {
    initProviders(config);
  }

  const preferredProvider = resolvePreferredProvider(config);
  const chain = globalRegistry.getFallbackChain(preferredProvider);

  if (chain.length === 0) {
    throw new Error("No LLM providers available. Check your API keys in config.json.");
  }

  // Response cache lookup
  if (options.useCache !== false) {
    const cache = getCache();
    const cachePrompt = buildCachePrompt(options.messages);
    const cacheModel = resolveProviderConfig(config, preferredProvider)?.model || "";
    const cached = cache.lookup(cachePrompt, cacheModel);
    if (cached && cached.hit) {
      if (options.onChunk) {
        options.onChunk({ type: "text", content: cached.response });
        options.onChunk({ type: "done" });
      }
      return {
        choices: [{ message: { role: "assistant", content: cached.response } }],
        model: cacheModel,
        cached: true,
      };
    }
  }

  // Streaming path
  if (options.stream && options.onChunk) {
    return await callLLMStream(config, options, chain, preferredProvider);
  }

  // Non-streaming path
  return await callLLMNonStream(options, chain);
}

/** Transcribe audio using Groq's Whisper API */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  fileName: string,
  apiKey: string
): Promise<string> {
  if (!apiKey) {
    throw new Error("Missing Groq API Key for transcription");
  }

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  formData.append("file", blob, fileName);
  formData.append("model", "whisper-large-v3");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq Whisper transcription failed (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text.trim();
}
