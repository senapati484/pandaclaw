// tests/cost-tracker.test.ts
import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import { CostTracker } from "../utils/cost-tracker.js";

describe("CostTracker", () => {
  beforeEach(() => {
    CostTracker.reset();
  });

  test("initial state is zero", () => {
    const summary = CostTracker.getSessionSummary();
    expect(summary.inputTokens).toBe(0);
    expect(summary.outputTokens).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalCostUsd).toBe(0);
  });

  test("tracks Groq model costs accurately", () => {
    // Groq Llama 3.3 70b Versatile: input 0.59, output 0.79 per 1M tokens
    // 100K input, 50K output
    CostTracker.track("llama-3.3-70b-versatile", 100_000, 50_000);

    const summary = CostTracker.getSessionSummary();
    expect(summary.inputTokens).toBe(100_000);
    expect(summary.outputTokens).toBe(50_000);
    expect(summary.totalTokens).toBe(150_000);

    // Cost: (100k * 0.59) / 1M + (50k * 0.79) / 1M = 0.059 + 0.0395 = 0.0985
    expect(summary.totalCostUsd).toBeCloseTo(0.0985, 6);
  });

  test("free models cost zero", () => {
    CostTracker.track("qwen/qwen3-coder:free", 200_000, 100_000);
    CostTracker.track("ollama/llama3", 50_000, 50_000);

    const summary = CostTracker.getSessionSummary();
    expect(summary.totalCostUsd).toBe(0);
  });

  test("resolves fuzzy substring model matches", () => {
    // should match "llama-3.3-70b-versatile" pricing due to substring
    CostTracker.track("Groq-Llama-3.3-70B-Versatile-Custom", 1_000_000, 1_000_000);
    const summary = CostTracker.getSessionSummary();
    // 1M * 0.59/1M + 1M * 0.79/1M = 0.59 + 0.79 = 1.38
    expect(summary.totalCostUsd).toBeCloseTo(1.38, 6);
  });

  test("resets stats successfully", () => {
    CostTracker.track("llama-3.3-70b-versatile", 10_000, 10_000);
    CostTracker.reset();
    const summary = CostTracker.getSessionSummary();
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.totalTokens).toBe(0);
  });

  test("returns valid badge string", () => {
    CostTracker.track("llama-3.3-70b-versatile", 10_000, 10_000);
    const badge = CostTracker.getBadgeText();
    expect(badge).toContain("20,000 tokens");
    expect(badge).toContain("$0.0138");
  });

  test("triggers cost limits correctly", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = spyOn(console, "error").mockImplementation(() => {});

    // Track a huge cost exceeding the default 0.50 session limit
    CostTracker.track("llama-3.3-70b-versatile", 1_000_000, 1_000_000); // Cost = $1.38

    expect(CostTracker.isLimitReached()).toBe(true);

    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  test("persists cost history to jsonl and recalls it", () => {
    process.env.PANDACLAW_TEST_WORKSPACE = "test-cost-tracker";
    CostTracker.reset();

    CostTracker.track("llama-3.3-70b-versatile", 10_000, 5_000);
    CostTracker.track("qwen/qwen3-coder:free", 50_000, 20_000);

    const history = CostTracker.getCostHistory();
    expect(history.length).toBe(2);
    expect(history[0]!.model).toBe("llama-3.3-70b-versatile");
    expect(history[0]!.inputTokens).toBe(10_000);
    expect(history[0]!.outputTokens).toBe(5_000);
    expect(history[1]!.model).toBe("qwen/qwen3-coder:free");

    // Clean up
    const { getMemoryDir } = require("../memory/store.js");
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(getMemoryDir(), "cost_history.jsonl");
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    delete process.env.PANDACLAW_TEST_WORKSPACE;
  });
});
