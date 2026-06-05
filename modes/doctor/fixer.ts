// modes/doctor/fixer.ts
// Auto-repair for `pandaclaw doctor --fix`. Each fix takes a `CheckResult`
// and the original `DoctorReport`, returns either a confirmation or an
// error message. All fixes are non-destructive: they create files, set
// sane defaults, or repair missing data — never modify API keys or
// overwrite existing user content.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import os from "os";
import type { CheckResult } from "./checks.js";
import { getMemoryDir, getMemoryPath } from "../../memory/store.js";
import { findConfigPath } from "../../ai/config-loader.js";

export interface FixResult {
  id: string;
  ok: boolean;
  message: string;
}

export type FixHandler = (result: CheckResult) => FixResult;

const handlers: Record<string, FixHandler> = {
  // Create the memory directory and any missing files inside it.
  "memory.dir": (result) => {
    const target = (result.data?.path as string) || getMemoryDir();
    if (!target) return { id: result.id, ok: false, message: "No path provided" };
    if (existsSync(target)) return { id: result.id, ok: true, message: "Already exists" };
    mkdirSync(target, { recursive: true });
    return { id: result.id, ok: true, message: `Created ${target}` };
  },

  // Touch memory.jsonl so subsequent saves don't have to.
  "memory.jsonl": (result) => {
    const target = (result.data?.path as string) || getMemoryPath();
    if (existsSync(target)) return { id: result.id, ok: true, message: "Already exists" };
    writeFileSync(target, "");
    return { id: result.id, ok: true, message: `Created ${target}` };
  },

  // Touch audit.jsonl.
  "memory.audit": (result) => {
    const target = (result.data?.path as string) || path.join(getMemoryDir(), "audit.jsonl");
    if (existsSync(target)) return { id: result.id, ok: true, message: "Already exists" };
    writeFileSync(target, "");
    return { id: result.id, ok: true, message: `Created ${target}` };
  },

  // Create the RAG db file (an empty file is enough; the store opens it on first write).
  "config.rag": (result) => {
    const target = (result.data?.dbPath as string) || path.join(os.homedir(), ".pandaclaw", "rag.db");
    if (existsSync(target)) return { id: result.id, ok: true, message: "Already exists" };
    // Make parent dir.
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "");
    return { id: result.id, ok: true, message: `Created ${target}` };
  },

  // Default the first agent when none is marked.
  "config.agents.default": (result) => {
    const firstId = (result.data?.firstId as string) || "main";
    return setAgentsDefault(firstId);
  },
};

function setAgentsDefault(id: string): FixResult {
  let cfgPath: string;
  try {
    cfgPath = findConfigPath();
  } catch {
    return { id: "config.agents.default", ok: false, message: "No config.json found to patch" };
  }
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch (err: any) {
    return { id: "config.agents.default", ok: false, message: `Cannot read config.json: ${err.message}` };
  }
  raw.agents = raw.agents ?? { default: "main", list: [] };
  raw.agents.default = id;
  // Mark the agent as default in the list as well.
  raw.agents.list = Array.isArray(raw.agents.list) ? raw.agents.list : [];
  for (const a of raw.agents.list) {
    if (a.id === id) a.isDefault = true;
  }
  try {
    writeFileSync(cfgPath, JSON.stringify(raw, null, 2) + "\n");
    return { id: "config.agents.default", ok: true, message: `Set default agent to "${id}"` };
  } catch (err: any) {
    return { id: "config.agents.default", ok: false, message: `Cannot write config.json: ${err.message}` };
  }
}

export interface FixSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  results: FixResult[];
  unfixable: CheckResult[];
}

export function applyFixes(report: { results: CheckResult[] }, options: { ids?: string[] } = {}): FixSummary {
  const results: FixResult[] = [];
  const unfixable: CheckResult[] = [];
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const r of report.results) {
    if (r.severity === "ok") continue;
    if (!r.fixable) {
      unfixable.push(r);
      continue;
    }
    // Restrict to specific ids if provided (for "fix this thing only" UX).
    if (options.ids && !options.ids.includes(r.id)) continue;

    const handler = handlers[r.id];
    if (!handler) {
      unfixable.push({ ...r, message: `${r.message} (no fix handler registered)` });
      continue;
    }
    attempted++;
    const out = handler(r);
    results.push(out);
    if (out.ok) succeeded++;
    else failed++;
  }

  return { attempted, succeeded, failed, results, unfixable };
}
