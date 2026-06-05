// utils/cost-tracker.ts
// Tracks prompt and completion tokens, estimates session USD cost, and handles budget alerts.

import chalk from "chalk";
import { readConfig } from "../ai/ai.config.js";
import { getMemoryDir } from "../memory/store.js";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "fs";
import path from "path";

const PRICING: Record<string, { input: number; output: number }> = {
  "llama-3.3-70b-versatile":     { input: 0.59,  output: 0.79  },  // Groq
  "llama-3.1-8b-instant":        { input: 0.05,  output: 0.08  },  // Groq 8B
  "qwen/qwen3-coder:free":       { input: 0.00,  output: 0.00  },  // OpenRouter free
  "google/gemma-4-26b-a4b-it":   { input: 0.00,  output: 0.00  },
  "qwen/qwen3-next-80b":         { input: 0.00,  output: 0.00  },
  "google/gemma-4-31b-it":       { input: 0.00,  output: 0.00  },
  "nvidia/nemotron-3-super":     { input: 0.00,  output: 0.00  },
  "meta-llama/llama-3.3-70b":    { input: 0.00,  output: 0.00  },
  "meta/llama-3.3-70b-instruct": { input: 0.39,  output: 0.39  },  // NIM
  "qwen3:0.6b":                  { input: 0.00,  output: 0.00  },  // Ollama local
};

export interface CostEvent {
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface SessionCostSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
}

class CostTrackerImpl {
  private sessionInputTokens = 0;
  private sessionOutputTokens = 0;
  private sessionCostUsd = 0;
  private warned = false;
  private limitReached = false;

  public reset(): void {
    this.sessionInputTokens = 0;
    this.sessionOutputTokens = 0;
    this.sessionCostUsd = 0;
    this.warned = false;
    this.limitReached = false;
  }

  public track(model: string, inputTokens: number, outputTokens: number): void {
    if (isNaN(inputTokens) || inputTokens < 0) inputTokens = 0;
    if (isNaN(outputTokens) || outputTokens < 0) outputTokens = 0;

    this.sessionInputTokens += inputTokens;
    this.sessionOutputTokens += outputTokens;

    const price = this.getPricing(model);
    const cost = ((inputTokens * price.input) + (outputTokens * price.output)) / 1_000_000;
    this.sessionCostUsd += cost;

    // Persist cost event to file
    try {
      const memoryDir = getMemoryDir();
      if (!existsSync(memoryDir)) {
        mkdirSync(memoryDir, { recursive: true });
      }
      const filePath = path.join(memoryDir, "cost_history.jsonl");
      const event: CostEvent = {
        timestamp: Date.now(),
        model,
        inputTokens,
        outputTokens,
        costUsd: cost,
      };
      appendFileSync(filePath, JSON.stringify(event) + "\n", "utf8");
    } catch (err: any) {
      // Fail-safe silently
    }

    this.checkBudgetLimits();
  }

  public getCostHistory(): CostEvent[] {
    try {
      const filePath = path.join(getMemoryDir(), "cost_history.jsonl");
      if (!existsSync(filePath)) return [];
      const content = readFileSync(filePath, "utf8");
      return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as CostEvent);
    } catch {
      return [];
    }
  }

  public getSessionSummary(): SessionCostSummary {
    return {
      inputTokens: this.sessionInputTokens,
      outputTokens: this.sessionOutputTokens,
      totalTokens: this.sessionInputTokens + this.sessionOutputTokens,
      totalCostUsd: this.sessionCostUsd,
    };
  }

  public getBadgeText(): string {
    const total = this.sessionInputTokens + this.sessionOutputTokens;
    const costStr = this.sessionCostUsd.toFixed(4);
    return ` · ${total.toLocaleString()} tokens · ~$${costStr}`;
  }

  public isLimitReached(): boolean {
    return this.limitReached;
  }

  private getPricing(model: string): { input: number; output: number } {
    const cleanModel = model.toLowerCase();

    // Check dynamic config.json pricing overrides first
    try {
      const config = readConfig();
      const customPricing = (config as any).pricing || {};
      for (const [key, val] of Object.entries(customPricing)) {
        if (cleanModel === key.toLowerCase() || cleanModel.includes(key.toLowerCase()) || key.toLowerCase().includes(cleanModel)) {
          return val as { input: number; output: number };
        }
      }
    } catch {}

    // Check exact matches
    for (const [key, val] of Object.entries(PRICING)) {
      if (cleanModel === key.toLowerCase()) {
        return val;
      }
    }

    // Check substring matches
    for (const [key, val] of Object.entries(PRICING)) {
      if (cleanModel.includes(key.toLowerCase()) || key.toLowerCase().includes(cleanModel)) {
        return val;
      }
    }

    // Free model detections
    if (cleanModel.includes("free") || cleanModel.includes("ollama") || cleanModel.includes("local") || cleanModel.includes("0.6b")) {
      return { input: 0, output: 0 };
    }

    // Default to a low standard fee (e.g. input $0.30, output $0.30 per 1M tokens) to prevent silent under-reporting
    return { input: 0.30, output: 0.30 };
  }

  private checkBudgetLimits(): void {
    try {
      const config = readConfig();
      const costGuard = config.cost_guard || {
        session_limit_usd: 0.50,
        warn_at_usd: 0.25,
        action: "warn"
      };

      const limit = costGuard.session_limit_usd ?? 0.50;
      const warnThreshold = costGuard.warn_at_usd ?? 0.25;

      if (this.sessionCostUsd >= limit) {
        this.limitReached = true;
        if (costGuard.action === "pause") {
          console.error(
            chalk.red(`\n🚨 [COST GUARD] Session cost limit ($${limit.toFixed(2)}) reached. Action set to 'pause'. Stopping execution.\n`)
          );
        } else if (!this.limitReached) {
          console.warn(
            chalk.yellow(`\n⚠️  [COST GUARD] Session cost ($${this.sessionCostUsd.toFixed(4)}) exceeded limit of $${limit.toFixed(2)}.\n`)
          );
        }
      } else if (this.sessionCostUsd >= warnThreshold && !this.warned) {
        this.warned = true;
        console.warn(
          chalk.yellow(`\n⚠️  [COST GUARD] Warning: Session cost ($${this.sessionCostUsd.toFixed(4)}) is nearing the limit of $${limit.toFixed(2)}.\n`)
        );
      }
    } catch {
      // If config reading fails, fail safe without crashing
    }
  }
}

export const CostTracker = new CostTrackerImpl();
