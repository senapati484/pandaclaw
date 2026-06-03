import { test, expect, describe } from "bun:test";
import { validateConfig } from "../ai/config-schema";

describe("Config Schema Validation", () => {
  const minimalValidConfig = {
    providers: {
      groq: { api_key: "gsk_test", api_base: "https://api.groq.com/openai/v1" },
      openrouter: { api_key: "sk-or-test", api_base: "https://openrouter.ai/api/v1" },
      nvidia_nim: { api_key: "nv-test", api_base: "https://integrate.api.nvidia.com/v1" },
    },
    routing: {
      fast_path: { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1, maxTokens: 2048 },
      fallback_chain: ["groq", "openrouter", "nvidia_nim", "ollama"],
    },
  };

  test("validates a minimal config successfully", () => {
    const validated = validateConfig(minimalValidConfig);
    expect(validated.providers.groq.api_key).toBe("gsk_test");
    expect(validated.routing.fast_path.model).toBe("llama-3.1-8b-instant");
  });

  test("applies default values for top-level missing fields", () => {
    const validated = validateConfig(minimalValidConfig);
    expect(validated.routing.fallback_chain).toEqual(["groq", "openrouter", "nvidia_nim", "ollama"]);
    expect(validated.memory?.path).toBe(".pandaclaw/memory.jsonl");
    expect(validated.audit?.enabled).toBe(true);
  });

  test("throws on missing required provider fields", () => {
    const badConfig = {
      providers: {
        groq: { api_base: "https://api.groq.com/openai/v1" },
      },
    };
    expect(() => validateConfig(badConfig)).toThrow("Config validation failed");
  });

  test("throws on empty provider api_key", () => {
    const badConfig = {
      providers: {
        groq: { api_key: "", api_base: "https://api.groq.com/openai/v1" },
        openrouter: { api_key: "", api_base: "https://openrouter.ai/api/v1" },
        nvidia_nim: { api_key: "", api_base: "https://integrate.api.nvidia.com/v1" },
      },
    };
    expect(() => validateConfig(badConfig)).toThrow("Config validation failed");
  });

  test("accepts full config with all optional sections", () => {
    const fullConfig = {
      providers: {
        groq: { api_key: "gsk_test", api_base: "https://api.groq.com/openai/v1" },
        openrouter: { api_key: "sk-or-test", api_base: "https://openrouter.ai/api/v1" },
        nvidia_nim: { api_key: "nv-test", api_base: "https://integrate.api.nvidia.com/v1" },
        ollama: { api_key: "ollama", api_base: "http://127.0.0.1:11434/v1" },
      },
      routing: {
        fast_path: { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1, maxTokens: 2048 },
        panda_mode: { provider: "openrouter", model: "qwen/qwen3-coder:free", temperature: 0.1, maxTokens: 8192 },
        planning: { provider: "openrouter", model: "qwen/qwen3-next-80b-a3b-instruct:free", temperature: 0.2, maxTokens: 4096 },
        fallback_chain: ["groq", "openrouter", "nvidia_nim", "ollama"],
      },
      tools: {
        web_search: { provider: "tavily", api_key: "tvly-test", fallback: "duckduckgo", maxResults: 5 },
        code_exec: { enabled: true, timeout_ms: 15000 },
      },
      memory: { path: ".pandaclaw/memory.jsonl", maxEntries: 100, maxLongTermFacts: 30 },
      audit: { path: ".pandaclaw/audit.jsonl", enabled: true },
      telegram: { token: "test:token", allowed_users: [12345] },
      github: {
        app_id: "123456",
        app_client_id: "test-client-id",
        installation_id: "test-install",
        pem_path: ".pandaclaw/test.pem",
        bot_name: "testbot",
        bot_email: "test@test.com",
      },
      agent: {
        maxIterations: 10,
        autoExecutePaths: ["src/"],
        askFirstPatterns: [".env"],
      },
    };

    const validated = validateConfig(fullConfig);
    expect(validated.providers.ollama?.api_key).toBe("ollama");
    expect(validated.tools?.web_search?.provider).toBe("tavily");
    expect(validated.telegram?.token).toBe("test:token");
    expect(validated.github?.app_id).toBe("123456");
    expect(validated.agent?.maxIterations).toBe(10);
  });

  test("validates fallback_chain with custom order", () => {
    const config = {
      ...minimalValidConfig,
      routing: {
        ...minimalValidConfig.routing,
        fallback_chain: ["openrouter", "groq"],
      },
    };
    const validated = validateConfig(config);
    expect(validated.routing.fallback_chain).toEqual(["openrouter", "groq"]);
  });
});
