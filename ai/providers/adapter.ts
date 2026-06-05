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
  private cooldowns = new Map<string, number>();

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

  setCooldown(name: string, durationMs: number): void {
    this.cooldowns.set(name, Date.now() + durationMs);
  }

  isCooledDown(name: string): boolean {
    const until = this.cooldowns.get(name);
    return !until || Date.now() >= until;
  }

  getFallbackChain(preferred?: string): ProviderAdapter[] {
    const chain: ProviderAdapter[] = [];
    const seen = new Set<string>();

    const addProvider = (name: string) => {
      if (seen.has(name)) return;
      const p = this.providers.get(name);
      if (p && p.isAvailable()) {
        chain.push(p);
        seen.add(name);
      }
    };

    if (preferred && this.providers.has(preferred)) {
      if (this.isCooledDown(preferred)) {
        addProvider(preferred);
      }
    }

    for (const name of this.fallbackOrder) {
      if (seen.has(name)) continue;
      if (!this.isCooledDown(name)) continue;
      addProvider(name);
    }

    // Fallback if all are cooled down
    if (chain.length === 0) {
      if (preferred && this.providers.has(preferred)) {
        addProvider(preferred);
      }
      for (const name of this.fallbackOrder) {
        addProvider(name);
      }
    }

    return chain;
  }

  clear(): void {
    this.providers.clear();
    this.fallbackOrder = [];
    this.cooldowns.clear();
  }
}

export const globalRegistry = new ProviderRegistry();
