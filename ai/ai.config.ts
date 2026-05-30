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
  telegram?: { token: string; allowed_users?: number[] };
  slack?: { webhook_url: string };
  /** GitHub App credentials for pandaclawbot[bot] identity */
  github?: {
    app_id: string;           // 3905611
    app_client_id: string;    // Iv23litqPgCUrnfX90U
    installation_id: string;  // from github.com/settings/installations/XXXXX
    pem_path: string;         // path to downloaded .pem file (default: .pandaclaw/github-app.pem)
    bot_name: string;         // "pandaclawbot[bot]"
    bot_email: string;        // "3905611+pandaclawbot[bot]@users.noreply.github.com"
  };
  agent?: {
    maxIterations: number;
    autoExecutePaths: string[];
    askFirstPatterns: string[];
  };
}

import os from "os";

let _config: PandaConfig | null = null;

export function readConfig(): PandaConfig {
  if (_config) return _config;

  let configPath = path.join(process.cwd(), "config.json");
  if (!existsSync(configPath)) {
    const globalPath = path.join(os.homedir(), ".pandaclaw", "config.json");
    if (existsSync(globalPath)) {
      configPath = globalPath;
    } else {
      throw new Error("config.json not found. Please run \"pandaclaw setup\" to configure your API keys.");
    }
  }

  const file = JSON.parse(readFileSync(configPath, "utf8")) as PandaConfig;

  // ── Load API keys from .env (env vars always override config.json) ──
  // Groq
  const groqKey = process.env.YOUR_GROQ_API_KEY || process.env.GROQ_API_KEY;
  if (groqKey) file.providers.groq.api_key = groqKey;

  // OpenRouter
  const orKey = process.env.YOUR_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (orKey) file.providers.openrouter.api_key = orKey;

  // Nvidia NIM
  const nimKey = process.env.NVIDIA_NIM_API_KEY || process.env.NVIDIA_NIM_KEY;
  if (nimKey) file.providers.nvidia_nim.api_key = nimKey;

  // Telegram
  const tgToken = process.env.TELEGRAM_TOKEN;
  if (tgToken)
    file.telegram = { ...(file.telegram ?? { token: "" }), token: tgToken };

  // GitHub App — allow env var overrides for CI/CD environments
  const ghAppId          = process.env.GITHUB_APP_ID;
  const ghInstallationId = process.env.GITHUB_INSTALLATION_ID;
  const ghPemPath        = process.env.GITHUB_PEM_PATH;
  if (ghAppId || ghInstallationId || ghPemPath) {
    file.github = {
      app_id:          ghAppId          || file.github?.app_id          || "3905611",
      app_client_id:   file.github?.app_client_id || "Iv23litqPgCUrnfX90U",
      installation_id: ghInstallationId || file.github?.installation_id || "",
      pem_path:        ghPemPath        || file.github?.pem_path        || ".pandaclaw/github-app.pem",
      bot_name:        file.github?.bot_name  || "pandaclawbot[bot]",
      bot_email:       file.github?.bot_email || "3905611+pandaclawbot[bot]@users.noreply.github.com",
    };
  }

  _config = file;
  return _config!;
}

/** Reset cached config (useful in tests) */
export function resetConfig(): void {
  _config = null;
}

/** Legacy export — kept for backwards compatibility with agent/model-selector */
export { readConfig as getAgentModel };