import { z } from "zod";

const providerSchema = z.object({
  api_key: z.string(),
  api_base: z.string().url().or(z.string().min(1)),
});

const routingEntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional().default(0.1),
  maxTokens: z.number().int().positive().optional().default(4096),
});

const telegramSchema = z.object({
  token: z.string(),
  allowed_users: z.array(z.number()).optional(),
}).optional();

const slackSchema = z.object({
  webhook_url: z.string().url().optional(),
}).optional();

const githubSchema = z.object({
  app_id: z.string(),
  app_client_id: z.string(),
  installation_id: z.string().optional().default(""),
  pem_path: z.string().optional().default(".pandaclaw/github-app.pem"),
  bot_name: z.string().optional().default("pandaclawbot[bot]"),
  bot_email: z.string().optional().default("3905611+pandaclawbot[bot]@users.noreply.github.com"),
}).optional();

const agentConfigSchema = z.object({
  maxIterations: z.number().int().positive().optional().default(20),
  autoExecutePaths: z.array(z.string()).optional().default(["src/", "tests/", "modes/"]),
  askFirstPatterns: z.array(z.string()).optional().default([".env", ".git", "package.json", "tsconfig.json"]),
}).optional();

export const pandaConfigSchema = z.object({
  providers: z.object({
    groq: providerSchema,
    openrouter: providerSchema,
    nvidia_nim: providerSchema,
    ollama: providerSchema.optional().default({ api_key: "ollama", api_base: "http://127.0.0.1:11434/v1" }),
  }),
  routing: z.object({
    fast_path: routingEntrySchema.default({ provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1, maxTokens: 2048 }),
    panda_mode: routingEntrySchema.optional().default({ provider: "openrouter", model: "qwen/qwen3-coder:free", temperature: 0.1, maxTokens: 8192 }),
    planning: routingEntrySchema.optional().default({ provider: "openrouter", model: "qwen/qwen3-next-80b-a3b-instruct:free", temperature: 0.2, maxTokens: 4096 }),
    fallback_chain: z.array(z.string()).default(["groq", "openrouter", "nvidia_nim", "ollama"]),
  }),
  tools: z.object({
    web_search: z.object({
      provider: z.string(),
      api_key: z.string(),
      fallback: z.string().optional(),
      maxResults: z.number().int().positive().optional(),
    }).optional(),
    code_exec: z.object({
      enabled: z.boolean().default(true),
      timeout_ms: z.number().int().positive().default(10000),
    }).optional(),
  }).default({ code_exec: { enabled: true, timeout_ms: 10000 } }),
  memory: z.object({
    path: z.string().default(".pandaclaw/memory.jsonl"),
    maxEntries: z.number().int().positive().default(200),
    maxLongTermFacts: z.number().int().positive().optional().default(50),
  }).default({ path: ".pandaclaw/memory.jsonl", maxEntries: 200, maxLongTermFacts: 50 }),
  audit: z.object({
    path: z.string().default(".pandaclaw/audit.jsonl"),
    enabled: z.boolean().default(true),
  }).default({ path: ".pandaclaw/audit.jsonl", enabled: true }),
  telegram: telegramSchema,
  slack: slackSchema,
  github: githubSchema,
  agent: agentConfigSchema,
});

export type ValidatedPandaConfig = z.infer<typeof pandaConfigSchema>;

export function validateConfig(raw: unknown): ValidatedPandaConfig {
  const result = pandaConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`
    ).join("\n");
    throw new Error(`Config validation failed:\n${issues}`);
  }
  return result.data;
}
