import type { ProviderAdapter, LLMCompletionOptions, LLMCompletionResult } from "./adapter.js";
import { makeCompletionRequest } from "./llm-utils.js";

export class NvidiaAdapter implements ProviderAdapter {
  readonly name = "nvidia_nim";
  private apiKey: string;
  private apiBase: string;
  private defaultModel: string;

  constructor(apiKey: string, apiBase: string, defaultModel = "meta/llama-3.1-70b-instruct") {
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
      useRetry: false,
    });
  }
}
