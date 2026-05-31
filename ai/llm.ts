// ai/llm.ts

import type { PandaConfig } from "./ai.config.js";
import chalk from "chalk";

export interface LLMCallOptions {
  messages: any[];
  tools?: any[];
  tool_choice?: string;
  temperature?: number;
  max_tokens?: number;
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        attempt++;
        if (attempt >= maxRetries) return res;

        const retryAfterHeader = res.headers.get("retry-after");
        let delayMs = 1500 * Math.pow(2, attempt - 1);
        if (retryAfterHeader) {
          const parsed = parseFloat(retryAfterHeader);
          if (!isNaN(parsed)) {
            delayMs = parsed * 1000;
          }
        }

        if (delayMs > 3000) {
          throw new Error(`Rate limit (429) hit on ${url} with a long delay of ${delayMs}ms. Failing immediately to trigger fallback.`);
        }

        console.warn(
          chalk.yellow(
            `\n⏳ Rate limit (429) hit on ${url}. Retrying in ${delayMs}ms... (Attempt ${attempt}/${maxRetries})\n`
          )
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      return res;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw err; // Timeout: propagate instantly
      }
      attempt++;
      if (attempt >= maxRetries) throw err;
      const delayMs = 1500 * Math.pow(2, attempt - 1);
      console.warn(
        chalk.yellow(
          `\n⚠️ Network/API error on ${url}: ${err.message}. Retrying in ${delayMs}ms...\n`
        )
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Max retries reached");
}

/**
 * Robust LLM completion call with automatic provider fallback and Groq tool-calling bug patching
 */
export async function callLLM(config: PandaConfig, options: LLMCallOptions): Promise<any> {
  const preferredProvider = config.routing.fast_path.provider || "groq";
  const fallbackChain = config.routing.fallback_chain || ["groq", "openrouter", "nvidia_nim"];

  // Create a unique list of providers to try, beginning with the preferred one
  const providersToTry = [preferredProvider, ...fallbackChain.filter(p => p !== preferredProvider)];

  let lastError: Error | null = null;

  for (const providerName of providersToTry) {
    const provider = config.providers[providerName as keyof typeof config.providers];
    if (!provider || !provider.api_key) {
      continue;
    }

    // Determine model
    let model = config.routing.fast_path.model;
    if (providerName !== preferredProvider) {
      // Fallback defaults
      if (providerName === "groq") {
        model = "llama-3.3-70b-versatile";
      } else if (providerName === "openrouter") {
        model = "openrouter/free";
      } else if (providerName === "nvidia_nim") {
        model = "meta/llama-3.2-11b-vision-instruct";
      } else if (providerName === "ollama") {
        model = "qwen3:0.6b";
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000);

    try {
      const res = await fetchWithRetry(`${provider.api_base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model,
          messages: sanitizeMessages(options.messages),
          tools: options.tools,
          tool_choice: options.tool_choice,
          temperature: options.temperature ?? 0.1,
          max_tokens: options.max_tokens,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text();
        
        // Handle Groq's tool-calling parser bug (400 Bad Request with tool_use_failed)
        if (providerName === "groq" && res.status === 400) {
          try {
            const errJson = JSON.parse(errText);
            if (errJson?.error?.code === "tool_use_failed" && errJson?.error?.failed_generation) {
              const fakeData = patchGroqToolCall(errJson.error.failed_generation);
              if (fakeData) {
                return fakeData;
              }
            }
          } catch {}
        }

        throw new Error(`Provider ${providerName} returned status ${res.status}: ${errText}`);
      }

      const data = (await res.json()) as any;
      const msg = data.choices?.[0]?.message;

      // Handle Groq's tool-calling bug where it returns 200 OK but outputs XML tags in content instead of tool_calls
      if (providerName === "groq" && msg?.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
        const parsed = parseTextToolCall(msg.content);
        if (parsed) {
          data.choices[0].message = {
            role: "assistant",
            tool_calls: [
              {
                id: "call_" + Math.random().toString(36).substring(2, 11),
                type: "function",
                function: parsed
              }
            ]
          };
        }
      }

      return data;
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === "AbortError";
      const errMsg = isTimeout ? "Request timed out after 12s" : err.message;
      lastError = isTimeout ? new Error(`${providerName} timed out after 12s`) : err;
    }
  }

  throw lastError || new Error("All LLM providers in fallback chain failed.");
}

export function sanitizeMessages(messages: any[]): any[] {
  return messages.map((m) => {
    const clean: any = {
      role: m.role,
    };

    if (m.role === "assistant") {
      if (m.tool_calls && m.tool_calls.length > 0) {
        clean.content = m.content || null;
        clean.tool_calls = m.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: tc.type || "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      } else {
        // Assistant message without tool calls MUST have string content (cannot be null)
        clean.content = m.content ?? "";
      }
    } else if (m.role === "tool") {
      clean.content = m.content ?? "";
      clean.tool_call_id = m.tool_call_id;
    } else {
      // user, system
      clean.content = m.content ?? "";
    }

    if (m.name !== undefined) clean.name = m.name;
    return clean;
  });
}

/**
 * Patch helper to reconstruct Groq's failed generation into a valid completions choice payload
 */
function patchGroqToolCall(failedGeneration: string): any | null {
  const match = failedGeneration.match(/<function=([\w_]+)>?\s*(\{[\s\S]*\})/i) || failedGeneration.match(/<function=([\w_]+)\s*(\{[\s\S]*\})/i);
  if (!match || !match[1] || !match[2]) return null;

  const toolName = match[1];
  let toolArgs = match[2].trim();

  // Clean trailing tags or comments if present
  if (toolArgs.includes("</function>")) {
    toolArgs = toolArgs.substring(0, toolArgs.indexOf("</function>")).trim();
  }
  if (toolArgs.startsWith("```")) {
    toolArgs = toolArgs.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "").trim();
  }

  try {
    JSON.parse(toolArgs);
    return createFakeCompletionsPayload(toolName, toolArgs);
  } catch {
    // Try to extract JSON
    const start = toolArgs.indexOf("{");
    const end = toolArgs.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      const clean = toolArgs.substring(start, end + 1);
      try {
        JSON.parse(clean);
        return createFakeCompletionsPayload(toolName, clean);
      } catch {}
    }
  }

  return null;
}

/**
 * Parse XML-like tool call embedded in a 200 OK assistant text response
 */
function parseTextToolCall(content: string): { name: string; arguments: string } | null {
  const match = content.match(/<function=([\w_]+)>?\s*(\{[\s\S]*\})/i) || content.match(/<function=([\w_]+)\s*(\{[\s\S]*\})/i);
  if (!match || !match[1] || !match[2]) return null;

  const toolName = match[1];
  let toolArgs = match[2].trim();

  if (toolArgs.includes("</function>")) {
    toolArgs = toolArgs.substring(0, toolArgs.indexOf("</function>")).trim();
  }
  if (toolArgs.startsWith("```")) {
    toolArgs = toolArgs.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "").trim();
  }

  try {
    JSON.parse(toolArgs);
    return { name: toolName, arguments: toolArgs };
  } catch {
    const start = toolArgs.indexOf("{");
    const end = toolArgs.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      const clean = toolArgs.substring(start, end + 1);
      try {
        JSON.parse(clean);
        return { name: toolName, arguments: clean };
      } catch {}
    }
  }

  return null;
}

function createFakeCompletionsPayload(toolName: string, toolArgs: string): any {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          tool_calls: [
            {
              id: "call_" + Math.random().toString(36).substring(2, 11),
              type: "function",
              function: {
                name: toolName,
                arguments: toolArgs
              }
            }
          ]
        }
      }
    ]
  };
}

/**
 * Transcribe an audio recording using Groq's Whisper API.
 * High-performance, low latency voice-to-text.
 */
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
