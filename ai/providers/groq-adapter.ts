import type { ProviderAdapter, LLMCompletionOptions, LLMCompletionResult } from "./adapter.js";
import { makeCompletionRequest, patchGroqToolCall, parseTextToolCall } from "./llm-utils.js";

export class GroqAdapter implements ProviderAdapter {
  readonly name = "groq";
  private apiKey: string;
  private apiBase: string;
  private defaultModel: string;

  constructor(apiKey: string, apiBase: string, defaultModel = "llama-3.3-70b-versatile") {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
    this.defaultModel = defaultModel;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async complete(options: LLMCompletionOptions): Promise<LLMCompletionResult> {
    try {
      const result = await makeCompletionRequest(this.apiBase, this.apiKey, this.defaultModel, options.messages, {
        ...options,
        useRetry: true,
      });

      // Handle Groq's XML tool call bug (200 OK but tool calls in content)
      const msgContent = result.content;
      if (msgContent && (!result.tool_calls || result.tool_calls.length === 0)) {
        const parsed = parseTextToolCall(msgContent);
        if (parsed) {
          return {
            content: null,
            tool_calls: [
              {
                id: "call_" + Math.random().toString(36).substring(2, 11),
                type: "function",
                function: parsed,
              },
            ],
            usage: result.usage,
            model: this.defaultModel,
          };
        }
      }

      return result;
    } catch (err: any) {
      if (err.message?.includes("tool_use_failed") && err.message?.includes("failed_generation")) {
        try {
          const start = err.message.indexOf("{");
          const end = err.message.lastIndexOf("}");
          if (start !== -1 && end !== -1) {
            const errJson = JSON.parse(err.message.substring(start, end + 1));
            if (errJson?.error?.failed_generation) {
              const fakeData = patchGroqToolCall(errJson.error.failed_generation);
              if (fakeData) return fakeData;
            }
          }
        } catch {}
      }
      throw err;
    }
  }
}
