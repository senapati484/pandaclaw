// modes/agent/agent-registry.ts
// AgentRegistry — owns the list of agents in a PandaClaw process.
// Designed to be the single source of truth for "which agents exist?".

import { existsSync, readFileSync } from "fs";
import path from "path";
import { validateConfig } from "../../ai/config-schema.js";
import type { AgentDefinition, AgentId, ChannelBinding } from "./agent-types.js";
import { parseBinding } from "./binding.js";

const DEFAULT_AGENT_ID = "main";

export interface AgentsConfigBlock {
  default?: AgentId;
  list?: Array<{
    id: string;
    workspace?: string;
    bindings?: string[];
    identity?: AgentDefinition["identity"];
    systemPromptPrefix?: string;
    isDefault?: boolean;
    metadata?: Record<string, unknown>;
  }>;
}

export interface AgentRegistryOptions {
  /** Fallback workspace used when an agent doesn't specify one. */
  defaultWorkspace?: string;
}

/**
 * In-memory registry. Constructed from a `PandaConfig.agents` block (or
 * synthesized from the legacy single-agent shape for back-compat).
 */
export class AgentRegistry {
  private agents: Map<AgentId, AgentDefinition> = new Map();
  private defaultAgentId: AgentId;

  constructor(
    private readonly block: AgentsConfigBlock | null,
    private readonly options: AgentRegistryOptions = {}
  ) {
    this.defaultAgentId = block?.default ?? DEFAULT_AGENT_ID;
    this.populateFromConfig();
  }

  // ============ Queries ============

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  has(id: AgentId): boolean {
    return this.agents.has(id);
  }

  get(id: AgentId): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  /** The agent that receives traffic with no binding match. */
  defaultAgent(): AgentDefinition {
    return this.agents.get(this.defaultAgentId) ?? this.synthesizeLegacyDefault();
  }

  defaultId(): AgentId {
    return this.defaultAgentId;
  }

  // ============ Mutations ============

  /**
   * Add a new agent. Throws if an agent with the same id already exists.
   * Use `upsert` if you want idempotent registration.
   */
  add(def: Omit<AgentDefinition, "bindings"> & { bindings: Array<string | ChannelBinding> }): AgentDefinition {
    const id = def.id;
    if (this.agents.has(id)) {
      throw new Error(`Agent "${id}" already exists`);
    }
    const full: AgentDefinition = {
      ...def,
      bindings: normalizeBindings(def.bindings),
    };
    this.agents.set(id, full);
    if (full.isDefault) this.defaultAgentId = id;
    return full;
  }

  /** Idempotent registration. */
  upsert(def: Omit<AgentDefinition, "bindings"> & { bindings: Array<string | ChannelBinding> }): AgentDefinition {
    if (this.agents.has(def.id)) {
      this.remove(def.id);
    }
    return this.add(def);
  }

  remove(id: AgentId): boolean {
    const had = this.agents.delete(id);
    if (had && id === this.defaultAgentId) {
      this.defaultAgentId = Array.from(this.agents.keys())[0] ?? DEFAULT_AGENT_ID;
    }
    return had;
  }

  setDefault(id: AgentId): void {
    if (!this.agents.has(id)) {
      throw new Error(`Cannot set default to unknown agent "${id}"`);
    }
    this.defaultAgentId = id;
  }

  // ============ Construction helpers ============

  private populateFromConfig(): void {
    if (!this.block?.list || this.block.list.length === 0) {
      // synthesize a single "main" agent from the legacy config shape
      this.agents.set(DEFAULT_AGENT_ID, this.synthesizeLegacyDefault());
      return;
    }
    for (const raw of this.block.list) {
      const bindings = (raw.bindings ?? []).map(parseBinding).filter((b): b is ChannelBinding => b !== null);
      const workspacePath = raw.workspace
        ? expandHome(raw.workspace)
        : this.options.defaultWorkspace ?? process.cwd();
      this.agents.set(raw.id, {
        id: raw.id,
        workspacePath,
        bindings,
        identity: raw.identity,
        systemPromptPrefix: raw.systemPromptPrefix,
        isDefault: raw.isDefault ?? raw.id === this.defaultAgentId,
        metadata: raw.metadata,
      });
    }
  }

  private synthesizeLegacyDefault(): AgentDefinition {
    return {
      id: DEFAULT_AGENT_ID,
      workspacePath: this.options.defaultWorkspace ?? process.cwd(),
      bindings: [{ raw: "*", platform: "*", pattern: "*" }],
      identity: { name: "PandaClaw", theme: "panda", emoji: "🐼" },
      isDefault: true,
    };
  }
}

function normalizeBindings(
  raw: Array<string | ChannelBinding>
): ChannelBinding[] {
  return raw
    .map((b) => (typeof b === "string" ? parseBinding(b) : b))
    .filter((b): b is ChannelBinding => b !== null);
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(process.env.HOME ?? "", p.slice(2));
  if (p.startsWith("~")) return process.env.HOME ?? p;
  return p;
}

/**
 * Load the agents block from a JSON config file. The "agents" key may be at
 * the top level (new) or under a `configVersion: 2` root (future). This
 * helper stays defensive and returns null when missing.
 */
export function loadAgentsBlockFromConfigFile(configPath: string): AgentsConfigBlock | null {
  if (!existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    // Run through the same Zod validator to peel off defaults
    const validated = validateConfig(raw);
    return (validated as any).agents ?? null;
  } catch {
    return null;
  }
}
