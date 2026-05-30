// tui/setup.ts

import { intro, outro, text, password, select, isCancel } from "@clack/prompts";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";

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
  config.routing.fast_path = config.routing.fast_path || { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.1, maxTokens: 2048 };
  config.routing.panda_mode = config.routing.panda_mode || { provider: "openrouter", model: "deepseek/deepseek-r1", temperature: 0.1, maxTokens: 8192 };
  config.routing.planning = config.routing.planning || { provider: "openrouter", model: "deepseek/deepseek-chat-v3-0324", temperature: 0.2, maxTokens: 4096 };
  config.routing.fallback_chain = config.routing.fallback_chain || ["groq", "openrouter", "nvidia_nim"];

  config.tools = config.tools || {};
  config.tools.web_search = config.tools.web_search || { provider: "tavily", api_key: "", fallback: "duckduckgo", maxResults: 5 };

  config.telegram = config.telegram || { token: "" };
  config.slack = config.slack || { webhook_url: "" };

  // 1. API Keys Section
  console.log(chalk.bold.magenta("\n🔑 [1/3] LLM & Provider API Keys"));

  const groqKey = await password({
    message: "Groq API Key (leave empty to keep current or skip)",
    mask: "*",
  });
  if (typeof groqKey === "string" && groqKey.trim() !== "") {
    config.providers.groq.api_key = groqKey.trim();
  }

  const orKey = await password({
    message: "OpenRouter API Key (leave empty to keep current or skip)",
    mask: "*",
  });
  if (typeof orKey === "string" && orKey.trim() !== "") {
    config.providers.openrouter.api_key = orKey.trim();
  }

  const nimKey = await password({
    message: "NVIDIA NIM API Key (leave empty to keep current or skip)",
    mask: "*",
  });
  if (typeof nimKey === "string" && nimKey.trim() !== "") {
    config.providers.nvidia_nim.api_key = nimKey.trim();
  }

  const tavilyKey = await password({
    message: "Tavily Search API Key (leave empty to keep current or skip)",
    mask: "*",
  });
  if (typeof tavilyKey === "string" && tavilyKey.trim() !== "") {
    config.tools.web_search.api_key = tavilyKey.trim();
  }

  // 2. Default Model Providers
  console.log(chalk.bold.magenta("\n🤖 [2/3] Routing & Preferred Providers"));

  const fastProvider = await select({
    message: "Select default Fast Path Provider",
    options: [
      { value: "groq", label: `Groq (currently: ${config.routing.fast_path.provider === "groq" ? "selected" : "configured"})` },
      { value: "openrouter", label: `OpenRouter (currently: ${config.routing.fast_path.provider === "openrouter" ? "selected" : "configured"})` },
      { value: "nvidia_nim", label: `NVIDIA NIM (currently: ${config.routing.fast_path.provider === "nvidia_nim" ? "selected" : "configured"})` },
    ],
  });
  if (typeof fastProvider === "string") {
    config.routing.fast_path.provider = fastProvider;
    // Auto-update model defaults if using Groq/OpenRouter
    if (fastProvider === "groq") {
      config.routing.fast_path.model = "llama-3.3-70b-versatile";
    } else if (fastProvider === "openrouter") {
      config.routing.fast_path.model = "openrouter/free";
    }
  }

  const fastModel = await text({
    message: "Fast Path Model ID",
    placeholder: config.routing.fast_path.model,
    defaultValue: config.routing.fast_path.model,
  });
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
  if (typeof planningProvider === "string") {
    config.routing.planning.provider = planningProvider;
  }

  const planningModel = await text({
    message: "Planning Model ID",
    placeholder: config.routing.planning.model,
    defaultValue: config.routing.planning.model,
  });
  if (typeof planningModel === "string" && planningModel.trim() !== "") {
    config.routing.planning.model = planningModel.trim();
  }

  // 3. Gateway & Integrations
  console.log(chalk.bold.magenta("\n💬 [3/3] Gateway & Platform Integrations"));

  const tgToken = await password({
    message: "Telegram Bot Token (leave empty to keep current or skip)",
    mask: "*",
  });
  if (typeof tgToken === "string" && tgToken.trim() !== "") {
    config.telegram.token = tgToken.trim();
  }

  const slackUrl = await password({
    message: "Slack Webhook URL (leave empty to keep current or skip)",
    mask: "*",
  });
  if (typeof slackUrl === "string" && slackUrl.trim() !== "") {
    config.slack.webhook_url = slackUrl.trim();
  }

  // Write changes
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    outro(chalk.bold.green(`✨ PandaClaw setup completed and saved to ${isGlobal ? "~/.pandaclaw/config.json" : "config.json"}! ✨`));
  } catch (err: any) {
    outro(chalk.bold.red(`Error writing configuration file: ${err.message}`));
  }
}
