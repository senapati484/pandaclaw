// modes/gateway/webhook.ts
// Handles webhook event parsing and agent execution for GitHub, Zapier, and custom integrations.

import chalk from "chalk";
import { readConfig } from "../../ai/ai.config.js";
import { classifyRoute } from "../ask/classifier.js";
import crypto, { createHmac, timingSafeEqual } from "crypto";
import { purple } from "../../utils/brand.js";

function verifyGitHubSignature(rawBody: string, secret: string, signatureHeader: string): boolean {
  if (!signatureHeader) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expectedSignature = signatureHeader.slice(7);
  const computedSignature = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(computedSignature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

function resolveTemplate(template: string, payload: any): string {
  return template.replace(/\{([^}]+)\}/g, (match, pathStr) => {
    const keys = pathStr.trim().split(".");
    let current = payload;
    for (const key of keys) {
      if (current === null || current === undefined) return "";
      current = current[key];
    }
    return current !== undefined && current !== null ? String(current) : "";
  });
}

function buildWebhookPrompt(
  source: string,
  payload: any,
  headers: Record<string, string>,
  hookConfig: any
): string {
  if (hookConfig.prompt_template) {
    return resolveTemplate(hookConfig.prompt_template, payload);
  }

  if (source === "github") {
    const event = headers["x-github-event"] || "push";
    const action = payload.action || "";
    const repo = payload.repository?.full_name || "unknown-repo";
    const sender = payload.sender?.login || "unknown-user";

    if (event === "issues") {
      const issueNum = payload.issue?.number;
      const issueTitle = payload.issue?.title || "";
      const issueBody = payload.issue?.body || "";
      return `GitHub webhook event: issues ${action} in repo "${repo}" by user "${sender}".\nIssue #${issueNum}: "${issueTitle}"\nBody: "${issueBody}"\n\nPlease diagnose this issue, investigate the relevant repository files if needed, and suggest a resolution.`;
    }

    if (event === "pull_request") {
      const prNum = payload.pull_request?.number;
      const prTitle = payload.pull_request?.title || "";
      return `GitHub webhook event: pull_request ${action} in repo "${repo}" by user "${sender}".\nPR #${prNum}: "${prTitle}"\nVerify the changes.`;
    }

    return `GitHub webhook event: "${event}" received in repo "${repo}" by user "${sender}".\nPayload: ${JSON.stringify(payload)}`;
  }

  if (source === "zapier") {
    return `Zapier webhook event received.\nPayload: ${JSON.stringify(payload)}\nAnalyze and execute required actions.`;
  }

  // Custom / Generic webhook
  return `Custom webhook event received from source "${source}".\nPayload: ${JSON.stringify(payload)}`;
}

async function runWebhookAgent(
  route: string,
  prompt: string,
  config: any,
  toolCtx: any
): Promise<string> {
  if (route === "action") {
    const { runToolAgent } = await import("../ask/tool-agent.js");
    const res = await runToolAgent(prompt, config, toolCtx);
    return res.answer;
  }

  if (route === "complex") {
    const { runPandaMode } = await import("../ask/panda-mode.js");
    const res = await runPandaMode({
      id: crypto.randomUUID(),
      type: "complex",
      input: prompt,
      conversationHistory: [],
      createdAt: new Date(),
    }, config);
    return res.answer;
  }

  const { runFastPath } = await import("../ask/fast-path.js");
  const res = await runFastPath({
    id: crypto.randomUUID(),
    type: "simple",
    input: prompt,
    conversationHistory: [],
    createdAt: new Date(),
  }, config);
  return res.answer;
}

export async function processWebhook(
  source: string,
  payload: any,
  headers: Record<string, string>,
  rawBody?: string
): Promise<{ success: boolean; answer?: string; error?: string }> {
  const config = readConfig();
  const webhooks = config.webhooks || [];
  const hookConfig = webhooks.find(h => h.source === source.toLowerCase().trim());

  if (!hookConfig) {
    return { success: false, error: `No configured webhook handler found for source: "${source}"` };
  }

  // Verify signature if secret is configured for GitHub webhook
  if (source === "github" && hookConfig.secret) {
    // Find x-hub-signature-256 case-insensitively
    const signatureHeader = headers["x-hub-signature-256"] || headers["X-Hub-Signature-256"] || "";
    if (!verifyGitHubSignature(rawBody || "", hookConfig.secret, signatureHeader)) {
      return { success: false, error: "GitHub signature verification failed" };
    }
  }

  // 1. Parse payload to build a prompt
  const prompt = buildWebhookPrompt(source, payload, headers, hookConfig);

  // 2. Classify and execute prompt
  const route = classifyRoute(prompt);
  const toolCtx = {
    userId: `webhook-${source}`,
    channel: hookConfig.channel as any,
    workspacePath: process.cwd(),
    requestConsent: async () => true, // Runs autonomously in background
  };

  console.log(purple(`\n🛜 [Webhook] Received "${source}" event. Executing via "${route}" route...`));

  try {
    const answer = await runWebhookAgent(route, prompt, config, toolCtx);
    // 3. Dispatch results to the configured channel
    await dispatchWebhookResult(hookConfig, answer);
    return { success: true, answer };
  } catch (err: any) {
    const errorMsg = `Webhook agent execution failed: ${err.message}`;
    console.error(chalk.red(`  ❌ ${errorMsg}`));
    await dispatchWebhookResult(hookConfig, `❌ Webhook handler failed: ${err.message}`);
    return { success: false, error: errorMsg };
  }
}

async function dispatchWebhookResult(hookConfig: any, result: string): Promise<void> {
  const channel = hookConfig.channel;
  if (channel === "telegram") {
    const config = readConfig();
    const token = config.telegram?.token ?? process.env.TELEGRAM_TOKEN;
    const chatId = hookConfig.chatId;

    if (!token || !chatId) {
      console.error(chalk.red(`  ⚠️ Cannot send Telegram notification for webhook: Missing bot token or chatId`));
      return;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `🛜 *PandaClaw Webhook Event Ingested*\n\n${result}`, parse_mode: "Markdown" }),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error(chalk.red(`  ⚠️ Telegram API error: ${txt}`));
      }
    } catch (e: any) {
      console.error(chalk.red(`  ⚠️ Telegram send failed: ${e.message}`));
    }
  } else if (channel === "slack") {
    const config = readConfig();
    const webhookUrl = config.slack?.webhook_url;
    if (!webhookUrl) {
      console.error(chalk.red(`  ⚠️ Cannot send Slack notification: Missing slack.webhook_url`));
      return;
    }
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `🛜 *PandaClaw Webhook Event Ingested*\n\n${result}` }),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error(chalk.red(`  ⚠️ Slack API error: ${txt}`));
      }
    } catch (e: any) {
      console.error(chalk.red(`  ⚠️ Slack send failed: ${e.message}`));
    }
  } else {
    // CLI log
    console.log(chalk.green(`\n🛜 [Webhook Output - ${hookConfig.source}]:`));
    console.log(result);
    console.log();
  }
}
