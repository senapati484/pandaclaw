import type { LLMCompletionOptions, LLMCompletionResult } from "./adapter.js";

/** Sentinel error for HTTP 429 — bypasses retry logic to immediately trigger provider fallback */
class RateLimitError extends Error {
  constructor(url: string, retryAfterSec: number) {
    super(
      `Rate limit (429) on ${url}${retryAfterSec > 0 ? ` (retry-after: ${retryAfterSec}s)` : ""}. Skipping to next provider.`
    );
    this.name = "RateLimitError";
  }
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit & { signal?: AbortSignal },
  maxRetries = 3
): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : 0;
        throw new RateLimitError(url, retryAfterSec);
      }
      return res;
    } catch (err: any) {
      if (err.name === "RateLimitError" || err.name === "AbortError") {
        throw err;
      }
      attempt++;
      if (attempt >= maxRetries) throw err;
      const delayMs = 1500 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Max retries reached");
}

export function sanitizeMessages(messages: any[]): any[] {
  return messages.map((m) => {
    const clean: any = { role: m.role };

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
        clean.content = m.content ?? "";
      }
    } else if (m.role === "tool") {
      clean.content = m.content ?? "";
      clean.tool_call_id = m.tool_call_id;
    } else {
      clean.content = m.content ?? "";
    }

    if (m.name !== undefined) clean.name = m.name;
    return clean;
  });
}

function parseFunctionTag(input: string): { name: string; args: string } | null {
  const match = input.match(/<function=([\w_]+)>?\s*(\{[\s\S]*\})/i) ||
    input.match(/<function=([\w_]+)\s*(\{[\s\S]*\})/i);
  if (!match || !match[1] || !match[2]) return null;

  const name = match[1];
  let args = match[2].trim();

  if (args.includes("</function>")) {
    args = args.substring(0, args.indexOf("</function>")).trim();
  }
  if (args.startsWith("```")) {
    args = args.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "").trim();
  }

  const tryParse = (str: string): boolean => {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  };

  if (tryParse(args)) {
    return { name, args };
  }

  const start = args.indexOf("{");
  const end = args.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    const clean = args.substring(start, end + 1);
    if (tryParse(clean)) {
      return { name, args: clean };
    }
  }

  return null;
}

export function patchGroqToolCall(failedGeneration: string): any | null {
  const parsed = parseFunctionTag(failedGeneration);
  return parsed ? createFakeCompletionsPayload(parsed.name, parsed.args) : null;
}

export function parseTextToolCall(content: string): { name: string; arguments: string } | null {
  const parsed = parseFunctionTag(content);
  return parsed ? { name: parsed.name, arguments: parsed.args } : null;
}

/**
 * Shared completion request for OpenAI-compatible providers.
 * Handles fetch → error check → JSON parse → return LLMCompletionResult.
 */
export async function makeCompletionRequest(
  apiBase: string,
  apiKey: string | null,
  model: string,
  messages: any[],
  options: LLMCompletionOptions & { extraHeaders?: Record<string, string>; useRetry?: boolean }
): Promise<LLMCompletionResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.extraHeaders,
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const body: Record<string, unknown> = {
    model,
    messages: sanitizeMessages(messages),
    temperature: options.temperature ?? 0.1,
    max_tokens: options.max_tokens,
    stream: false,
  };
  if (options.tools) body.tools = options.tools;
  if (options.tool_choice) body.tool_choice = options.tool_choice;

  const fetcher = options.useRetry !== false ? fetchWithRetry : fetch;
  const res = await fetcher(`${apiBase}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${model} returned status ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as any;
  return {
    content: data.choices?.[0]?.message?.content ?? null,
    tool_calls: data.choices?.[0]?.message?.tool_calls,
    usage: data.usage,
    model,
  };
}

function createFakeCompletionsPayload(toolName: string, toolArgs: string): any {
  return {
    content: null,
    tool_calls: [
      {
        id: "call_" + Math.random().toString(36).substring(2, 11),
        type: "function",
        function: { name: toolName, arguments: toolArgs },
      },
    ],
    model: "groq-patched",
  };
}
