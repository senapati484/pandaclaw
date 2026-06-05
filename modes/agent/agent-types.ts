// modes/agent/agent-types.ts
// Multi-agent types — one process can run many isolated agents, each with
// its own workspace, channel bindings, and identity. Inspired by OpenClaw's
// `agents list/add/bind` but adapted to PandaClaw's existing types.

import type { PandaConfig } from "../../ai/ai.config.js";

export type AgentId = string;

/**
 * Pattern syntax for binding a channel to an agent:
 *   "telegram:*"            → all Telegram chats
 *   "telegram:-1001234567"  → only the chat with that exact id
 *   "telegram:ops-*"        → any chat whose id starts with "ops-"
 *   "telegram"              → platform-wide (all Telegram chats)
 *   "*"                     → all channels, all chats (catch-all default)
 */
export interface ChannelBinding {
  raw: string; // the original "platform:pattern" string for diagnostics
  platform: string; // "telegram" | "slack" | "webchat" | ...
  pattern: string; // "*" | exact id | prefix-with-trailing-*
}

export interface AgentIdentity {
  name: string;
  theme?: string;
  emoji?: string;
  avatar?: string; // workspace-relative path, http(s) URL, or data URI
}

export interface AgentDefinition {
  id: AgentId;
  workspacePath: string; // where this agent reads/writes files
  bindings: ChannelBinding[]; // ordered; first match wins
  identity?: AgentIdentity;
  /** Optional system-prompt prefix; prepended to every ask-mode prompt. */
  systemPromptPrefix?: string;
  /** Whether this is the default agent for unbound traffic. */
  isDefault?: boolean;
  /** Free-form metadata (for the CLI / dashboard). */
  metadata?: Record<string, unknown>;
}

/**
 * Per-agent config slice. Built from the global PandaConfig plus the
 * agent's own overrides (workspace, identity, etc.).
 */
export interface AgentConfig extends PandaConfig {
  agentId: AgentId;
  workspacePath: string;
  identity?: AgentIdentity;
  systemPromptPrefix?: string;
  bindings: ChannelBinding[];
}

export interface RoutingDecision {
  agent: AgentDefinition;
  reason: "exact" | "prefix" | "platform" | "wildcard" | "default";
  matchedBinding?: ChannelBinding;
}
