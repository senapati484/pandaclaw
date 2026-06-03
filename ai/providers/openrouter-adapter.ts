import type { ProviderAdapter, LLMCompletionOptions, LLMCompletionResult } from "./adapter.js";
import { makeCompletionRequest } from "./llm-utils.js";

export class OpenRouterAdapter implements ProviderAdapter {
  readonly name = "openrouter";
  private apiKey: string;
  private apiBase: string;
  private defaultModel: string;

  constructor(apiKey: string, apiBase: string, defaultModel = "google/gemma-4-26b-a4b-it:free") {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
    this.defaultModel = defaultModel;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async complete(options: LLMCompletionOptions): Promise<LLMCompletionResult> {
    return makeCompletionRequest(this.apiBase, this.apiKey, this.defaultModel, options.messages, {
      ...options,
      extraHeaders: {
        "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
        "X-Title": "PandaClaw",
      },
    });
  }
}
