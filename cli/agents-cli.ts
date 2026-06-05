// cli/agents-cli.ts
// `pandaclaw agents list` — print the configured agents and their bindings.
// Used for debugging routing without spinning up the full gateway.

import { readConfig } from "../ai/ai.config.js";
import { AgentRegistry } from "../modes/agent/agent-registry.js";
import { AgentRouter } from "../modes/agent/agent-router.js";
import { purple } from "../utils/brand.js";
import chalk from "chalk";

export interface AgentsListOptions {
  json?: boolean;
}

export function agentsListCommand(opts: AgentsListOptions = {}): void {
  const cfg = readConfig() as any;
  const registry = new AgentRegistry(cfg.agents ?? null);
  const router = new AgentRouter(registry);

  if (opts.json) {
    const out = {
      default: registry.defaultId(),
      agents: registry.list().map((a) => ({
        id: a.id,
        workspace: a.workspacePath,
        bindings: a.bindings.map((b) => b.raw),
        identity: a.identity,
        isDefault: a.isDefault ?? false,
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(purple("\n🐼 PandaClaw Agents\n"));
  console.log(chalk.gray(`Default: ${registry.defaultId()}\n`));
  for (const a of registry.list()) {
    const tag = a.isDefault ? chalk.yellow(" [default]") : "";
    const bindings = a.bindings.map((b) => b.raw).join(", ") || "(none)";
    console.log(`• ${a.id}${tag}`);
    console.log(chalk.gray(`    workspace: ${a.workspacePath}`));
    console.log(chalk.gray(`    bindings:  ${bindings}`));
    if (a.identity) {
      const ident = [a.identity.emoji, a.identity.name].filter(Boolean).join(" ");
      console.log(chalk.gray(`    identity:  ${ident}`));
    }
    if (a.systemPromptPrefix) {
      console.log(chalk.gray(`    system:    ${a.systemPromptPrefix.slice(0, 60)}`));
    }
    console.log();
  }
}

export interface AgentsExplainOptions {
  platform: string;
  chatId: string;
  json?: boolean;
}

export function agentsExplainCommand(opts: AgentsExplainOptions): void {
  const cfg = readConfig() as any;
  const registry = new AgentRegistry(cfg.agents ?? null);
  const router = new AgentRouter(registry);
  const explanation = router.explain(opts.platform, opts.chatId);

  if (opts.json) {
    console.log(JSON.stringify({
      platform: opts.platform,
      chatId: opts.chatId,
      matches: explanation.map((m) => ({
        agent: m.agent.id,
        binding: m.binding?.raw,
        reason: m.reason,
      })),
      winner: {
        agent: explanation[0]!.agent.id,
        binding: explanation[0]!.binding?.raw,
        reason: explanation[0]!.reason,
      },
    }, null, 2));
    return;
  }

  console.log(purple(`\n🐼 Routing for ${opts.platform}:${opts.chatId}\n`));
  for (const m of explanation) {
    const binding = m.binding?.raw ?? "(default)";
    console.log(`  → ${m.agent.id}  via  ${binding}  [${m.reason}]`);
  }
  if (explanation.length > 1) {
    console.log(chalk.gray(`\n  Winner: ${explanation[0]!.agent.id}`));
  }
  console.log();
}
