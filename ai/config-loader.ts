// ai/config-loader.ts

import { readFileSync, existsSync } from "fs";
import path from "path";
import * as os from "os";
import { validateConfig, type ValidatedPandaConfig } from "./config-schema.js";
import { applyEnvironmentOverrides } from "./config-overrides.js";

export type PandaConfig = ValidatedPandaConfig;

let _config: PandaConfig | null = null;

function findConfigPath(): string {
  const localPath = path.join(process.cwd(), "config.json");
  if (existsSync(localPath)) return localPath;

  const globalPath = path.join(os.homedir(), ".pandaclaw", "config.json");
  if (existsSync(globalPath)) return globalPath;

  throw new Error("config.json not found. Please run \"pandaclaw setup\" to configure your API keys.");
}

export { findConfigPath };

export function readConfig(): PandaConfig {
  if (_config) return _config;

  const configPath = findConfigPath();
  const rawFile = JSON.parse(readFileSync(configPath, "utf8"));

  applyEnvironmentOverrides(rawFile);

  const config = validateConfig(rawFile);
  _config = config;
  return config;
}
