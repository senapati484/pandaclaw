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
      }
    }

    try {
      const res = await fetch(`${provider.api_base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model,
          messages: options.messages,
          tools: options.tools,
          tool_choice: options.tool_choice,
          temperature: options.temperature ?? 0.1,
          max_tokens: options.max_tokens,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        
        // Handle Groq's tool-calling parser bug (400 Bad Request with tool_use_failed)
        if (providerName === "groq" && res.status === 400) {
          try {
            const errJson = JSON.parse(errText);
            if (errJson?.error?.code === "tool_use_failed" && errJson?.error?.failed_generation) {
              const fakeData = patchGroqToolCall(errJson.error.failed_generation);
              if (fakeData) {
                console.log(chalk.yellow(`      [Groq Patch] Successfully intercepted and parsed failed tool call generation.`));
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
          console.log(chalk.yellow(`      [Groq Patch] Parsed tool call from text content.`));
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
      console.log(chalk.yellow(`      [LLM Fallback Warning] Provider ${providerName} failed: ${err.message || err}. Trying next...`));
      lastError = err;
    }
  }

  throw lastError || new Error("All LLM providers in fallback chain failed.");
}

/**
 * Patch helper to reconstruct Groq's failed generation into a valid completions choice payload
 */
function patchGroqToolCall(failedGeneration: string): any | null {
  const match = failedGeneration.match(/<function=([\w_]+)>?\s*(\{[\s\S]*\})/i) || failedGeneration.match(/<function=([\w_]+)\s*(\{[\s\S]*\})/i);
  if (!match) return null;

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
  if (!match) return null;

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
