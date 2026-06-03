import type { ProviderAdapter, LLMCompletionOptions, LLMCompletionResult } from "./adapter.js";
import { makeCompletionRequest } from "./llm-utils.js";

export class OllamaAdapter implements ProviderAdapter {
  readonly name = "ollama";
  private apiBase: string;
  private defaultModel: string;

  constructor(apiBase: string, defaultModel = "qwen3:0.6b") {
    this.apiBase = apiBase;
    this.defaultModel = defaultModel;
  }

  isAvailable(): boolean {
    return true;
  }

  async complete(options: LLMCompletionOptions): Promise<LLMCompletionResult> {
    return makeCompletionRequest(this.apiBase, null, this.defaultModel, options.messages, options);
  }
}
