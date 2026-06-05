// tests/webhook.test.ts
import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import { processWebhook } from "../modes/gateway/webhook.js";
import * as aiConfig from "../ai/ai.config.js";

describe("Webhook Ingestion", () => {
  let configSpy: any;
  let fetchSpy: any;

  beforeEach(() => {
    configSpy = spyOn(aiConfig, "readConfig").mockReturnValue({
      providers: {
        groq: { api_key: "test-groq-key", api_base: "https://api.groq.com" },
        openrouter: { api_key: "test-or-key", api_base: "https://openrouter.ai" },
        nvidia_nim: { api_key: "test-nim-key", api_base: "https://nim" },
        ollama: { api_key: "test-ollama-key", api_base: "https://ollama" }
      },
      routing: {
        fast_path: { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1, maxTokens: 2048 },
        panda_mode: { provider: "openrouter", model: "qwen/qwen3-coder:free", temperature: 0.1, maxTokens: 8192 },
        planning: { provider: "openrouter", model: "qwen/qwen3-next-80b-a3b-instruct:free", temperature: 0.2, maxTokens: 4096 },
        fallback_chain: ["groq"]
      },
      webhooks: [
        {
          source: "github",
          secret: "test-secret",
          channel: "cli"
        }
      ]
    } as any);

    // Mock fetch for LLM call within webhook execution
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Here is the issue diagnostic result." } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 }
        })
      } as any;
    }) as any);
  });

  afterEach(() => {
    configSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  test("returns error for unconfigured webhook source", async () => {
    const result = await processWebhook("zapier", {}, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("No configured webhook handler found");
  });

  test("processes GitHub issue opened event successfully", async () => {
    const payload = {
      action: "opened",
      repository: { full_name: "senapati484/pandaclaw" },
      sender: { login: "testuser" },
      issue: {
        number: 42,
        title: "Database crash",
        body: "The database crashed unexpectedly."
      }
    };

    const headers = {
      "x-github-event": "issues"
    };

    const result = await processWebhook("github", payload, headers);
    expect(result.success).toBe(true);
    expect(result.answer).toContain("diagnostic result");
  });
});
