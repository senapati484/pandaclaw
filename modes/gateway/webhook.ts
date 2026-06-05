// modes/gateway/webhook.ts
// Handles webhook event parsing and agent execution for GitHub, Zapier, and custom integrations.

import chalk from "chalk";
import { readConfig } from "../../ai/ai.config.js";
import { classifyRoute } from "../ask/classifier.js";

export async function processWebhook(
  source: string,
  payload: any,
  headers: Record<string, string>
): Promise<{ success: boolean; answer?: string; error?: string }> {
  const config = readConfig();
  const webhooks = config.webhooks || [];
  const hookConfig = webhooks.find(h => h.source === source.toLowerCase().trim());

  if (!hookConfig) {
    return { success: false, error: `No configured webhook handler found for source: "${source}"` };
  }

  // 1. Parse payload to build a prompt
  let prompt = "";
  if (source === "github") {
    const event = headers["x-github-event"] || "push";
    const action = payload.action || "";
    const repo = payload.repository?.full_name || "unknown-repo";
    const sender = payload.sender?.login || "unknown-user";

    if (event === "issues") {
      const issueNum = payload.issue?.number;
      const issueTitle = payload.issue?.title || "";
      const issueBody = payload.issue?.body || "";
      prompt = `GitHub webhook event: issues ${action} in repo "${repo}" by user "${sender}".\nIssue #${issueNum}: "${issueTitle}"\nBody: "${issueBody}"\n\nPlease diagnose this issue, investigate the relevant repository files if needed, and suggest a resolution.`;
    } else if (event === "pull_request") {
      const prNum = payload.pull_request?.number;
      const prTitle = payload.pull_request?.title || "";
      prompt = `GitHub webhook event: pull_request ${action} in repo "${repo}" by user "${sender}".\nPR #${prNum}: "${prTitle}"\nVerify the changes.`;
    } else {
      prompt = `GitHub webhook event: "${event}" received in repo "${repo}" by user "${sender}".\nPayload: ${JSON.stringify(payload)}`;
    }
  } else if (source === "zapier") {
    prompt = `Zapier webhook event received.\nPayload: ${JSON.stringify(payload)}\nAnalyze and execute required actions.`;
  } else {
    // Custom / Generic webhook
    prompt = `Custom webhook event received from source "${source}".\nPayload: ${JSON.stringify(payload)}`;
  }

  // 2. Classify and execute prompt
  const route = classifyRoute(prompt);
  const toolCtx = {
    userId: `webhook-${source}`,
    channel: hookConfig.channel as any,
    workspacePath: process.cwd(),
    requestConsent: async () => true, // Runs autonomously in background
  };

  console.log(chalk.hex("#5b4d9e")(`\n🛜 [Webhook] Received "${source}" event. Executing via "${route}" route...`));

  let answer = "";
  try {
    if (route === "action") {
      const { runToolAgent } = await import("../ask/tool-agent.js");
      const res = await runToolAgent(prompt, config, toolCtx);
      answer = res.answer;
    } else if (route === "complex") {
      const { runPandaMode } = await import("../ask/panda-mode.js");
      const res = await runPandaMode({
        id: crypto.randomUUID(),
        type: "complex",
        input: prompt,
        conversationHistory: [],
        createdAt: new Date(),
      }, config);
      answer = res.answer;
    } else {
      const { runFastPath } = await import("../ask/fast-path.js");
      const res = await runFastPath({
        id: crypto.randomUUID(),
        type: "simple",
        input: prompt,
        conversationHistory: [],
        createdAt: new Date(),
      }, config);
      answer = res.answer;
    }

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
