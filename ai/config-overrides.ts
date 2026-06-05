// ai/config-overrides.ts

function applyProviderOverrides(providers: any): void {
  const groqKey = process.env.YOUR_GROQ_API_KEY || process.env.GROQ_API_KEY;
  if (groqKey && providers?.groq) {
    providers.groq.api_key = groqKey;
  }

  const orKey = process.env.YOUR_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (orKey && providers?.openrouter) {
    providers.openrouter.api_key = orKey;
  }

  const nimKey = process.env.NVIDIA_NIM_API_KEY || process.env.NVIDIA_NIM_KEY;
  if (nimKey && providers?.nvidia_nim) {
    providers.nvidia_nim.api_key = nimKey;
  }

  const ollamaBase = process.env.OLLAMA_API_BASE || process.env.OLLAMA_BASE_URL;
  if (ollamaBase && providers?.ollama) {
    providers.ollama.api_base = ollamaBase;
  }
}

function applyTelegramOverrides(rawFile: any): void {
  const tgToken = process.env.TELEGRAM_TOKEN || (rawFile.telegram ? rawFile.telegram.token : "");
  if (!tgToken) return;

  const allowed = rawFile.telegram ? rawFile.telegram.allowed_users : [];
  rawFile.telegram = {
    token: tgToken,
    allowed_users: allowed || [],
  };
}

function applyGithubOverrides(rawFile: any): void {
  const ghAppId = process.env.GITHUB_APP_ID;
  const ghInstId = process.env.GITHUB_INSTALLATION_ID;
  const ghPem = process.env.GITHUB_PEM_PATH;

  if (!ghAppId && !ghInstId && !ghPem) return;

  const github = rawFile.github || {};
  rawFile.github = {
    app_id: ghAppId || github.app_id || "",
    app_client_id: github.app_client_id || "",
    installation_id: ghInstId || github.installation_id || "",
    pem_path: ghPem || github.pem_path || "",
    bot_name: github.bot_name || "",
    bot_email: github.bot_email || "",
  };
}

export function applyEnvironmentOverrides(rawFile: any): void {
  if (rawFile.providers) {
    applyProviderOverrides(rawFile.providers);
  }
  applyTelegramOverrides(rawFile);
  applyGithubOverrides(rawFile);
}
