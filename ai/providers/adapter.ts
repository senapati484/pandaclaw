export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface LLMCompletionOptions {
  messages: LLMMessage[];
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: "auto" | "none" | "required";
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}

export interface LLMCompletionResult {
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

export interface ProviderAdapter {
  readonly name: string;
  complete(options: LLMCompletionOptions): Promise<LLMCompletionResult>;
  isAvailable(): boolean;
}

export class ProviderRegistry {
  private providers = new Map<string, ProviderAdapter>();
  private fallbackOrder: string[] = [];

  register(adapter: ProviderAdapter): void {
    this.providers.set(adapter.name, adapter);
    if (!this.fallbackOrder.includes(adapter.name)) {
      this.fallbackOrder.push(adapter.name);
    }
  }

  setFallbackOrder(order: string[]): void {
    this.fallbackOrder = order;
  }

  get(name: string): ProviderAdapter | undefined {
    return this.providers.get(name);
  }

  getAllAvailable(): ProviderAdapter[] {
    return Array.from(this.providers.values()).filter((p) => p.isAvailable());
  }

  getFallbackChain(preferred?: string): ProviderAdapter[] {
    const chain: ProviderAdapter[] = [];
    const seen = new Set<string>();

    if (preferred && this.providers.has(preferred)) {
      const p = this.providers.get(preferred)!;
      if (p.isAvailable()) {
        chain.push(p);
        seen.add(preferred);
      }
    }

    for (const name of this.fallbackOrder) {
      if (seen.has(name)) continue;
      const p = this.providers.get(name);
      if (p && p.isAvailable()) {
        chain.push(p);
        seen.add(name);
      }
    }

    return chain;
  }

  clear(): void {
    this.providers.clear();
    this.fallbackOrder = [];
  }
}

export const globalRegistry = new ProviderRegistry();
