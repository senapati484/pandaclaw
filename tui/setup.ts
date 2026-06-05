// tui/setup.ts

import { intro, outro, text, password, select, isCancel } from "@clack/prompts";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";

function initializeSetupConfig(configPath: string, configDir: string, isGlobal: boolean): any {
  let config: any = {};

  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      console.log(chalk.yellow("Warning: config.json was corrupted. Creating a new one."));
    }
  } else if (isGlobal) {
    try {
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
    } catch (err: any) {
      console.log(chalk.red(`Error creating global config directory: ${err.message}`));
    }
  }

  // Ensure namespaces exist
  config.providers = config.providers || {};
  config.providers.groq = config.providers.groq || { api_key: "", api_base: "https://api.groq.com/openai/v1" };
  config.providers.openrouter = config.providers.openrouter || { api_key: "", api_base: "https://openrouter.ai/api/v1" };
  config.providers.nvidia_nim = config.providers.nvidia_nim || { api_key: "", api_base: "https://integrate.api.nvidia.com/v1" };

  config.routing = config.routing || {};
  config.routing.fast_path = config.routing.fast_path || { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1, maxTokens: 2048 };
  config.routing.panda_mode = config.routing.panda_mode || { provider: "openrouter", model: "qwen/qwen3-coder:free", temperature: 0.1, maxTokens: 8192 };
  config.routing.planning = config.routing.planning || { provider: "openrouter", model: "qwen/qwen3-next-80b-a3b-instruct:free", temperature: 0.2, maxTokens: 4096 };
  config.routing.fallback_chain = config.routing.fallback_chain || ["groq", "openrouter", "nvidia_nim", "ollama"];

  config.tools = config.tools || {};
  config.tools.web_search = config.tools.web_search || { provider: "tavily", api_key: "", fallback: "duckduckgo", maxResults: 5 };

  config.telegram = config.telegram || { token: "" };
  config.slack = config.slack || { webhook_url: "" };

  return config;
}

async function promptApiKeys(config: any): Promise<boolean> {
  console.log(chalk.bold.magenta("\n🔑 [1/3] LLM & Provider API Keys"));

  const groqKey = await password({
    message: "Groq API Key (leave empty to keep current or skip)",
    mask: "*",
  });
  if (isCancel(groqKey)) return false;
  if (typeof groqKey === "string" && groqKey.trim() !== "") {
    config.providers.groq.api_key = groqKey.trim();
  }

  const orKey = await password({
    message: "OpenRouter API Key (leave empty to keep current or skip)",
    mask: "*",
  });
  if (isCancel(orKey)) return false;
  if (typeof orKey === "string" && orKey.trim() !== "") {
    config.providers.openrouter.api_key = orKey.trim();
  }

  const nimKey = await password({
    message: "NVIDIA NIM API Key (leave empty to keep current or skip)",
    mask: "*",
  });
  if (isCancel(nimKey)) return false;
  if (typeof nimKey === "string" && nimKey.trim() !== "") {
    config.providers.nvidia_nim.api_key = nimKey.trim();
  }

  const tavilyKey = await password({
    message: "Tavily Search API Key (leave empty to keep current or skip)",
    mask: "*",
  });
  if (isCancel(tavilyKey)) return false;
  if (typeof tavilyKey === "string" && tavilyKey.trim() !== "") {
    config.tools.web_search.api_key = tavilyKey.trim();
  }

  return true;
}

async function promptRoutingConfig(config: any): Promise<boolean> {
  console.log(chalk.bold.magenta("\n🤖 [2/3] Routing & Preferred Providers"));

  const fastProvider = await select({
    message: "Select default Fast Path Provider",
    options: [
      { value: "groq", label: `Groq (currently: ${config.routing.fast_path.provider === "groq" ? "selected" : "configured"})` },
      { value: "openrouter", label: `OpenRouter (currently: ${config.routing.fast_path.provider === "openrouter" ? "selected" : "configured"})` },
      { value: "nvidia_nim", label: `NVIDIA NIM (currently: ${config.routing.fast_path.provider === "nvidia_nim" ? "selected" : "configured"})` },
    ],
  });
  if (isCancel(fastProvider)) return false;
  if (typeof fastProvider === "string") {
    config.routing.fast_path.provider = fastProvider;
    if (fastProvider === "groq") {
      config.routing.fast_path.model = "llama-3.1-8b-instant";
    } else if (fastProvider === "openrouter") {
      config.routing.fast_path.model = "openrouter/free";
    }
  }

  const fastModel = await text({
    message: "Fast Path Model ID",
    placeholder: config.routing.fast_path.model,
    defaultValue: config.routing.fast_path.model,
  });
  if (isCancel(fastModel)) return false;
  if (typeof fastModel === "string" && fastModel.trim() !== "") {
    config.routing.fast_path.model = fastModel.trim();
  }

  const planningProvider = await select({
    message: "Select default Planning/Deep Thinking Provider",
    options: [
      { value: "openrouter", label: `OpenRouter (currently: ${config.routing.planning.provider === "openrouter" ? "selected" : "configured"})` },
      { value: "groq", label: `Groq (currently: ${config.routing.planning.provider === "groq" ? "selected" : "configured"})` },
      { value: "nvidia_nim", label: `NVIDIA NIM (currently: ${config.routing.planning.provider === "nvidia_nim" ? "selected" : "configured"})` },
    ],
  });
  if (isCancel(planningProvider)) return false;
  if (typeof planningProvider === "string") {
    config.routing.planning.provider = planningProvider;
  }

  const planningModel = await text({
    message: "Planning Model ID",
    placeholder: config.routing.planning.model,
    defaultValue: config.routing.planning.model,
  });
  if (isCancel(planningModel)) return false;
  if (typeof planningModel === "string" && planningModel.trim() !== "") {
    config.routing.planning.model = planningModel.trim();
  }

  return true;
}

async function promptGateways(config: any): Promise<boolean> {
  console.log(chalk.bold.magenta("\n💬 [3/3] Gateway & Platform Integrations"));

  const tgToken = await password({
    message: "Telegram Bot Token (leave empty to use the default shared PandaClaw bot)",
    mask: "*",
  });
  if (isCancel(tgToken)) return false;
  if (typeof tgToken === "string" && tgToken.trim() !== "") {
    config.telegram = config.telegram || {};
    config.telegram.token = tgToken.trim();
  }

  const slackUrl = await password({
    message: "Slack Webhook URL (leave empty to keep current or skip)",
    mask: "*",
  });
  if (isCancel(slackUrl)) return false;
  if (typeof slackUrl === "string" && slackUrl.trim() !== "") {
    config.slack.webhook_url = slackUrl.trim();
  }

  return true;
}

function saveSetupConfig(configPath: string, config: any, isGlobal: boolean): void {
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    outro(chalk.bold.green(`✨ PandaClaw setup completed and saved to ${isGlobal ? "~/.pandaclaw/config.json" : "config.json"}! ✨`));
  } catch (err: any) {
    outro(chalk.bold.red(`Error writing configuration file: ${err.message}`));
  }
}

export async function runSetup(): Promise<void> {
  intro(chalk.bold.cyan("🐼 PandaClaw Configuration Setup Wizard 🐼"));

  const scope = await select({
    message: "Configure PandaClaw globally or locally for this project?",
    options: [
      { value: "global", label: "Globally (~/.pandaclaw/config.json)" },
      { value: "local", label: "Locally (./config.json)" },
    ],
  });

  if (isCancel(scope)) {
    outro(chalk.yellow("Setup cancelled."));
    return;
  }

  const isGlobal = scope === "global";
  const configDir = isGlobal 
    ? path.join(os.homedir(), ".pandaclaw") 
    : process.cwd();
  
  const configPath = path.join(configDir, "config.json");
  const config = initializeSetupConfig(configPath, configDir, isGlobal);

  if (!(await promptApiKeys(config))) {
    outro(chalk.yellow("Setup cancelled."));
    return;
  }

  if (!(await promptRoutingConfig(config))) {
    outro(chalk.yellow("Setup cancelled."));
    return;
  }

  if (!(await promptGateways(config))) {
    outro(chalk.yellow("Setup cancelled."));
    return;
  }

  saveSetupConfig(configPath, config, isGlobal);
}
