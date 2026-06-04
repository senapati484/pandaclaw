// ai/ai.config.ts

import { readFileSync, existsSync } from "fs";
import path from "path";
import { validateConfig, type ValidatedPandaConfig } from "./config-schema.js";

export type PandaConfig = ValidatedPandaConfig;

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

  const rawFile = JSON.parse(readFileSync(configPath, "utf8"));

  // ── Load API keys from .env (env vars always override config.json) ──
  const groqKey = process.env.YOUR_GROQ_API_KEY || process.env.GROQ_API_KEY;
  if (groqKey && rawFile.providers) rawFile.providers.groq.api_key = groqKey;

  const orKey = process.env.YOUR_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (orKey && rawFile.providers) rawFile.providers.openrouter.api_key = orKey;

  const nimKey = process.env.NVIDIA_NIM_API_KEY || process.env.NVIDIA_NIM_KEY;
  if (nimKey && rawFile.providers) rawFile.providers.nvidia_nim.api_key = nimKey;

  const ollamaBase = process.env.OLLAMA_API_BASE || process.env.OLLAMA_BASE_URL;
  if (ollamaBase && rawFile.providers?.ollama) rawFile.providers.ollama.api_base = ollamaBase;

  const tgToken = process.env.TELEGRAM_TOKEN || rawFile.telegram?.token || "";
  if (tgToken) {
    rawFile.telegram = {
      token: tgToken,
      allowed_users: rawFile.telegram?.allowed_users ?? []
    };
  }

  const ghAppId          = process.env.GITHUB_APP_ID;
  const ghInstallationId = process.env.GITHUB_INSTALLATION_ID;
  const ghPemPath        = process.env.GITHUB_PEM_PATH;
  if (ghAppId || ghInstallationId || ghPemPath) {
    rawFile.github = {
      app_id:          ghAppId          || rawFile.github?.app_id          || "",
      app_client_id:   rawFile.github?.app_client_id || "",
      installation_id: ghInstallationId || rawFile.github?.installation_id || "",
      pem_path:        ghPemPath        || rawFile.github?.pem_path        || "",
      bot_name:        rawFile.github?.bot_name  || "",
      bot_email:       rawFile.github?.bot_email || "",
    };
  }

  // Validate with Zod schema
  const config = validateConfig(rawFile);

  _config = config;
  return config;
}

/** Reset cached config (useful in tests) */
export function resetConfig(): void {
  _config = null;
}

