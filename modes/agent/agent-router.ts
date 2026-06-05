// modes/agent/agent-router.ts
// Given an inbound (platform, chatId), pick the right agent from the registry.
// Specificity wins: exact > prefix > platform > wildcard. Declaration order
// is the tie-breaker so that the user can express "this chat should go to
// the work agent, even though the main agent also has a platform match".
// If nothing matches, the registry's default agent handles the message.

import type { AgentRegistry } from "./agent-registry.js";
import type { AgentDefinition, ChannelBinding, RoutingDecision } from "./agent-types.js";
import { matchBinding } from "./binding.js";

/** Higher = more specific. Used as the primary sort key. */
const SPECIFICITY: Record<NonNullable<ReturnType<typeof matchBinding>>, number> = {
  exact: 4,
  prefix: 3,
  platform: 2,
  wildcard: 1,
};

type Candidate = { agent: AgentDefinition; binding: ChannelBinding; reason: NonNullable<ReturnType<typeof matchBinding>>; order: number };

export class AgentRouter {
  constructor(private readonly registry: AgentRegistry) {}

  /**
   * Collect and sort all matching (agent, binding) candidates for a given
   * (platform, chatId) pair, in specificity order. Most specific first;
   * earliest-declared wins on tie.
   */
  private collectCandidates(platform: string, chatId: string): Candidate[] {
    const candidates: Candidate[] = [];
    let order = 0;
    for (const agent of this.registry.list()) {
      for (const binding of agent.bindings) {
        const reason = matchBinding(binding, platform, chatId);
        if (reason !== null) {
          candidates.push({ agent, binding, reason, order: order++ });
        }
      }
    }
    candidates.sort((a, b) => {
      const sa = SPECIFICITY[a.reason];
      const sb = SPECIFICITY[b.reason];
      if (sa !== sb) return sb - sa;
      return a.order - b.order; // earlier declaration wins on tie
    });
    return candidates;
  }

  /**
   * Find the agent that should handle a message from `platform` / `chatId`.
   * Always returns a decision (the default agent is the fallback).
   */
  route(platform: string, chatId: string): RoutingDecision {
    const candidates = this.collectCandidates(platform, chatId);
    if (candidates.length > 0) {
      const winner = candidates[0]!;
      return { agent: winner.agent, reason: winner.reason, matchedBinding: winner.binding };
    }
    return { agent: this.registry.defaultAgent(), reason: "default" };
  }

  /**
   * Returns the set of agents that would receive traffic from a given platform.
   * Useful for the dashboard's "agent → channels" view.
   */
  agentsForPlatform(platform: string): AgentDefinition[] {
    const seen = new Set<AgentDefinition>();
    const out: AgentDefinition[] = [];
    for (const agent of this.registry.list()) {
      for (const binding of agent.bindings) {
        const matches =
          binding.platform === "*" ||
          binding.platform === platform;
        if (matches && !seen.has(agent)) {
          seen.add(agent);
          out.push(agent);
        }
      }
    }
    return out;
  }

  /**
   * Returns the bindings that this (platform, chatId) pair actually matches,
   * sorted by specificity (most specific first). Useful for debugging
   * "why is this going to agent X?".
   */
  explain(platform: string, chatId: string): Array<{ agent: AgentDefinition; binding?: ChannelBinding; reason: RoutingDecision["reason"] }> {
    const candidates = this.collectCandidates(platform, chatId);
    if (candidates.length === 0) {
      return [{ agent: this.registry.defaultAgent(), reason: "default" }];
    }
    return candidates.map((c) => ({ agent: c.agent, binding: c.binding, reason: c.reason }));
  }
}
