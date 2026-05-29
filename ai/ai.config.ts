// ai/ai.config.ts

import { readFileSync, existsSync } from "fs";
import path from "path";

export interface PandaConfig {
  providers: {
    groq:       { api_key: string; api_base: string };
    openrouter: { api_key: string; api_base: string };
    nvidia_nim: { api_key: string; api_base: string };
  };
  routing: {
    fast_path:         { provider: string; model: string; temperature: number; maxTokens: number };
    panda_mode:        { provider: string; model: string; temperature: number; maxTokens: number };
    planning:          { provider: string; model: string; temperature: number; maxTokens: number };
    vision_screenshot: { provider: string; model: string };
    vision_document:   { provider: string; model: string };
    vision_chart:      { provider: string; model: string };
    vision_code:       { provider: string; model: string };
    fallback_chain:    string[];
  };
  tools?: {
    web_search?: { provider: string; api_key: string; fallback: string; maxResults: number };
    code_exec?:  { enabled: boolean; timeout_ms: number };
  };
  memory?: { path: string; maxEntries: number; maxLongTermFacts?: number };
  audit?:  { path: string; enabled: boolean };
  telegram?: { token: string; allowed_users: number[] };
  agent?: {
    maxIterations: number;
    autoExecutePaths: string[];
    askFirstPatterns: string[];
  };
}

let _config: PandaConfig | null = null;

export function readConfig(): PandaConfig {
  if (_config) return _config;

  const configPath = path.join(process.cwd(), "config.json");
  if (!existsSync(configPath)) {
    throw new Error("config.json not found. Copy config.example.json and fill in your API keys.");
  }

  const file = JSON.parse(readFileSync(configPath, "utf8")) as PandaConfig;

  // Allow env var overrides (CI/Docker)
  if (process.env.GROQ_API_KEY)
    file.providers.groq.api_key = process.env.GROQ_API_KEY;
  if (process.env.YOUR_GROQ_API_KEY)
    file.providers.groq.api_key = process.env.YOUR_GROQ_API_KEY;
  if (process.env.OPENROUTER_API_KEY)
    file.providers.openrouter.api_key = process.env.OPENROUTER_API_KEY;
  if (process.env.YOUR_OPENROUTER_API_KEY)
    file.providers.openrouter.api_key = process.env.YOUR_OPENROUTER_API_KEY;
  if (process.env.NVIDIA_NIM_KEY)
    file.providers.nvidia_nim.api_key = process.env.NVIDIA_NIM_KEY;
  if (process.env.TELEGRAM_TOKEN)
    file.telegram = { ...(file.telegram ?? { token: "", allowed_users: [] }), token: process.env.TELEGRAM_TOKEN };

  _config = file;
  return _config!;
}

/** Reset cached config (useful in tests) */
export function resetConfig(): void {
  _config = null;
}

/** Legacy export — kept for backwards compatibility with agent/model-selector */
export { readConfig as getAgentModel };