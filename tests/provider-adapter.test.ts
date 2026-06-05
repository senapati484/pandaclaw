import { test, expect, describe } from "bun:test";
import { ProviderRegistry } from "../ai/providers/adapter";
import type { ProviderAdapter, LLMCompletionOptions, LLMCompletionResult } from "../ai/providers/adapter";

class MockProvider implements ProviderAdapter {
  readonly name: string;
  private available: boolean;
  private failCount: number;

  constructor(name: string, available = true, failCount = 0) {
    this.name = name;
    this.available = available;
    this.failCount = failCount;
  }

  isAvailable(): boolean {
    return this.available;
  }

  async complete(_options: LLMCompletionOptions): Promise<LLMCompletionResult> {
    if (this.failCount > 0) {
      this.failCount--;
      throw new Error(`${this.name} failed`);
    }
    return { content: `response from ${this.name}`, model: this.name };
  }
}

describe("ProviderRegistry", () => {
  test("registers and retrieves providers", () => {
    const registry = new ProviderRegistry();
    const provider = new MockProvider("test");
    registry.register(provider);

    expect(registry.get("test")).toBe(provider);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  test("getAllAvailable returns only available providers", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider("available", true));
    registry.register(new MockProvider("unavailable", false));

    const available = registry.getAllAvailable();
    expect(available.length).toBe(1);
    expect(available[0]?.name).toBe("available");
  });

  test("getFallbackChain respects preferred provider", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider("slow", true));
    registry.register(new MockProvider("fast", true));
    registry.register(new MockProvider("backup", true));
    registry.setFallbackOrder(["slow", "backup"]);

    const chain = registry.getFallbackChain("fast");
    expect(chain.length).toBe(3);
    expect(chain[0]?.name).toBe("fast");
    expect(chain[1]?.name).toBe("slow");
    expect(chain[2]?.name).toBe("backup");
  });

  test("getFallbackChain skips unavailable providers", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider("primary", false));
    registry.register(new MockProvider("secondary", true));
    registry.setFallbackOrder(["primary", "secondary"]);

    const chain = registry.getFallbackChain("primary");
    expect(chain.length).toBe(1);
    expect(chain[0]?.name).toBe("secondary");
  });

  test("getFallbackChain returns empty when nothing available", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider("offline", false));
    registry.setFallbackOrder(["offline"]);

    const chain = registry.getFallbackChain("offline");
    expect(chain.length).toBe(0);
  });

  test("clear removes all providers", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider("p1", true));
    registry.register(new MockProvider("p2", true));
    registry.clear();

    expect(registry.getAllAvailable().length).toBe(0);
  });

  test("deduplicates fallback chain", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider("p1", true));
    registry.setFallbackOrder(["p1", "p1", "p1"]);

    const chain = registry.getFallbackChain("p1");
    expect(chain.length).toBe(1);
  });

  test("complete returns correct response from provider", async () => {
    const provider = new MockProvider("test", true);
    const result = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("response from test");
    expect(result.model).toBe("test");
  });

  test("manages cooldowns correctly", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider("p1", true));
    registry.register(new MockProvider("p2", true));
    registry.setFallbackOrder(["p1", "p2"]);

    // Initial state: not on cooldown
    expect(registry.isCooledDown("p1")).toBe(true);

    // Set cooldown
    registry.setCooldown("p1", 10000);
    expect(registry.isCooledDown("p1")).toBe(false);

    // getFallbackChain should skip p1 (on cooldown) and return p2
    const chain = registry.getFallbackChain("p1");
    expect(chain.length).toBe(1);
    expect(chain[0]?.name).toBe("p2");

    // If all are on cooldown, it should fallback to returning all of them
    registry.setCooldown("p2", 10000);
    expect(registry.isCooledDown("p2")).toBe(false);

    const fallbackAllChain = registry.getFallbackChain("p1");
    expect(fallbackAllChain.length).toBe(2);
    expect(fallbackAllChain[0]?.name).toBe("p1");
    expect(fallbackAllChain[1]?.name).toBe("p2");
  });
});
