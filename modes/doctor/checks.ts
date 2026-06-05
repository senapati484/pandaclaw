// modes/doctor/checks.ts
// `pandaclaw doctor` — health checks for the local PandaClaw installation.
// Read-only: returns a structured report. The fixer module in fixer.ts
// handles the `--fix` flag and only mutates state when explicitly asked.

import { existsSync, readFileSync, accessSync, constants, readdirSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import * as os from "os";
import { readConfig } from "../../ai/ai.config.js";
import { parseBinding } from "../agent/binding.js";
import { getMemoryDir, getMemoryPath } from "../../memory/store.js";

export type Severity = "ok" | "warn" | "fail" | "info";

export interface CheckResult {
  id: string;
  severity: Severity;
  message: string;
  detail?: string;
  fixable: boolean;
  data?: Record<string, unknown>;
}

export interface DoctorReport {
  ranAt: string;
  cwd: string;
  bunVersion: string;
  results: CheckResult[];
  summary: { ok: number; warn: number; fail: number; info: number; total: number };
}

function summarize(results: CheckResult[]): DoctorReport["summary"] {
  const c = { ok: 0, warn: 0, fail: 0, info: 0, total: results.length };
  for (const r of results) c[r.severity]++;
  return c;
}

function bunVersion(): string {
  try {
    const r = spawnSync("bun", ["--version"], { encoding: "utf8" });
    return r.stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function which(cmd: string): string | null {
  try {
    const r = spawnSync("which", [cmd], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch {}
  return null;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

// ──────────────────────────────────────────────────────────────────────────
// Individual checks. Each returns 0..N CheckResults. Kept short and
// side-effect free; the high-level runChecks() composes them.
// ──────────────────────────────────────────────────────────────────────────

function checkBun(): CheckResult {
  const bv = bunVersion();
  if (bv === "unknown") {
    return { id: "runtime.bun", severity: "fail", message: "Bun is not on PATH", detail: "Install Bun: https://bun.sh", fixable: false };
  }
  const major = parseInt(bv.split(".")[0] ?? "0", 10);
  if (Number.isNaN(major) || major < 1) {
    return { id: "runtime.bun", severity: "warn", message: `Bun ${bv} is old (recommend 1.3+)`, fixable: false, data: { version: bv } };
  }
  return { id: "runtime.bun", severity: "ok", message: `Bun ${bv}`, fixable: false, data: { version: bv } };
}

function checkConfig(): { cfg: any | null; result: CheckResult } {
  try {
    const cfg = readConfig();
    return { cfg, result: { id: "config.load", severity: "ok", message: "config.json loaded and validated", fixable: false } };
  } catch (err: any) {
    return {
      cfg: null,
      result: { id: "config.load", severity: "fail", message: "config.json missing or invalid", detail: err?.message ?? String(err), fixable: false },
    };
  }
}

function checkProviders(cfg: any): CheckResult[] {
  const providers = cfg.providers ?? {};
  const providerIds = ["groq", "openrouter", "nvidia_nim", "ollama"];
  const configured = providerIds.filter((p) => providers[p]?.api_key && String(providers[p].api_key).trim().length > 0);
  if (configured.length === 0) {
    return [{
      id: "config.providers",
      severity: "fail",
      message: "No providers have an API key configured",
      detail: "Run `pandaclaw setup` to add at least one provider (Groq, OpenRouter, or NVIDIA NIM).",
      fixable: false,
    }];
  }
  return [{ id: "config.providers", severity: "ok", message: `${configured.length} provider(s) configured: ${configured.join(", ")}`, fixable: false, data: { configured } }];
}

function checkRouting(cfg: any): CheckResult[] {
  const routing = cfg.routing ?? {};
  if (!routing.fast_path) {
    return [{ id: "config.routing", severity: "fail", message: "routing.fast_path is missing", fixable: false }];
  }
  const fp = routing.fast_path;
  const providerOk = cfg.providers?.[fp.provider]?.api_key;
  if (!providerOk) {
    return [{
      id: "config.routing.fast_path",
      severity: "warn",
      message: `fast_path uses ${fp.provider} but it has no API key`,
      detail: "Set the API key in config.json or use a configured provider.",
      fixable: false,
      data: { provider: fp.provider },
    }];
  }
  return [{ id: "config.routing.fast_path", severity: "ok", message: `fast_path → ${fp.provider}/${fp.model}`, fixable: false }];
}

function checkSecurity(cfg: any): CheckResult {
  const security = (cfg.security ?? {}) as Record<string, Record<string, string>>;
  const askOrDeny = Object.values(security).flatMap((p) => Object.values(p)).filter((v) => v === "ask" || v === "deny").length;
  if (askOrDeny === 0) {
    return { id: "config.security", severity: "info", message: "No tools have risk-level 'ask' or 'deny'", detail: "All tools run as 'safe' by default. Consider tightening high-impact tools.", fixable: false };
  }
  return { id: "config.security", severity: "ok", message: `${askOrDeny} tool(s) gated at 'ask' or 'deny'`, fixable: false, data: { askOrDeny } };
}

function checkTelegram(cfg: any): CheckResult {
  if (!cfg.telegram?.token) {
    return { id: "config.telegram", severity: "info", message: "Telegram not configured (optional)", fixable: false };
  }
  const parts = cfg.telegram.token.split(":");
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]!)) {
    return { id: "config.telegram", severity: "warn", message: "Telegram token doesn't look like a valid bot token", fixable: false, data: { tokenLength: cfg.telegram.token.length } };
  }
  return { id: "config.telegram", severity: "ok", message: "Telegram token looks valid", fixable: false };
}

function checkSlack(cfg: any): CheckResult {
  if (!cfg.slack?.webhook_url) {
    return { id: "config.slack", severity: "info", message: "Slack not configured (optional)", fixable: false };
  }
  try {
    const u = new URL(cfg.slack.webhook_url);
    if (!u.hostname.endsWith(".slack.com")) {
      return { id: "config.slack", severity: "warn", message: "Slack webhook URL is not on slack.com", fixable: false, data: { url: cfg.slack.webhook_url } };
    }
    return { id: "config.slack", severity: "ok", message: "Slack webhook looks valid", fixable: false };
  } catch {
    return { id: "config.slack", severity: "warn", message: "Slack webhook URL is not a valid URL", fixable: false, data: { url: cfg.slack.webhook_url } };
  }
}

function checkAgents(cfg: any): CheckResult[] {
  const agentList: any[] = cfg.agents?.list ?? [];
  if (agentList.length === 0) {
    return [{ id: "config.agents", severity: "info", message: "No multi-agents configured (single-agent mode)", fixable: false }];
  }
  const unparseable: string[] = [];
  for (const a of agentList) {
    for (const b of a.bindings ?? []) {
      if (!parseBinding(b)) unparseable.push(`${a.id}:${b}`);
    }
  }
  if (unparseable.length > 0) {
    return [{ id: "config.agents.bindings", severity: "warn", message: `${unparseable.length} binding(s) could not be parsed`, detail: unparseable.join(", "), fixable: false, data: { unparseable } }];
  }
  const defaultCount = agentList.filter((a) => a.isDefault).length + (cfg.agents?.default ? 1 : 0);
  if (defaultCount === 0 && agentList[0]) {
    return [{ id: "config.agents.default", severity: "warn", message: "No default agent set (first agent in list will be used)", fixable: true, data: { firstId: agentList[0].id } }];
  }
  return [{ id: "config.agents", severity: "ok", message: `${agentList.length} agent(s) configured`, fixable: false, data: { count: agentList.length } }];
}

function checkMcp(cfg: any): CheckResult[] {
  const servers: any[] = cfg.mcp?.servers ?? [];
  const out: CheckResult[] = [];
  for (const s of servers) {
    const cmd = s.command;
    const abs = path.isAbsolute(cmd) ? cmd : which(cmd);
    if (abs) {
      out.push({ id: `config.mcp.${s.name}`, severity: "ok", message: `MCP server "${s.name}" command resolved (${abs})`, fixable: false, data: { command: cmd } });
    } else {
      out.push({ id: `config.mcp.${s.name}`, severity: "fail", message: `MCP server "${s.name}" command not found: ${cmd}`, detail: "Install the command or fix the path in config.json under mcp.servers.", fixable: false, data: { command: cmd } });
    }
  }
  if (cfg.mcp?.enabled && servers.length === 0) {
    out.push({ id: "config.mcp", severity: "info", message: "MCP enabled, no servers configured", fixable: false });
  }
  return out;
}

function checkRag(cfg: any): CheckResult[] {
  if (!cfg.rag?.enabled) return [];
  const dbPath = expandHome(cfg.rag.dbPath);
  if (existsSync(dbPath)) {
    return [{ id: "config.rag", severity: "ok", message: `RAG db exists at ${dbPath}`, fixable: false, data: { dbPath } }];
  }
  return [{ id: "config.rag", severity: "info", message: `RAG db will be created at ${dbPath} on first use`, fixable: true, data: { dbPath } }];
}

function checkMemoryDir(): CheckResult[] {
  const memDir = getMemoryDir();
  if (!existsSync(memDir)) {
    return [{ id: "memory.dir", severity: "warn", message: `Memory dir missing: ${memDir}`, fixable: true, data: { path: memDir } }];
  }
  const out: CheckResult[] = [{ id: "memory.dir", severity: "ok", message: `Memory dir present: ${memDir}`, fixable: false, data: { path: memDir } }];

  // memory.jsonl
  const memPath = getMemoryPath();
  if (existsSync(memPath)) {
    try {
      const content = readFileSync(memPath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      let bad = 0;
      for (const line of lines) {
        try { JSON.parse(line); } catch { bad++; }
      }
      if (bad > 0) {
        out.push({ id: "memory.jsonl", severity: "warn", message: `memory.jsonl has ${bad} unparseable line(s) out of ${lines.length}`, fixable: false, data: { total: lines.length, bad } });
      } else {
        out.push({ id: "memory.jsonl", severity: "ok", message: `memory.jsonl: ${lines.length} valid entries`, fixable: false, data: { total: lines.length } });
      }
    } catch (err: any) {
      out.push({ id: "memory.jsonl", severity: "fail", message: `Cannot read memory.jsonl: ${err.message}`, fixable: false });
    }
  } else {
    out.push({ id: "memory.jsonl", severity: "info", message: "memory.jsonl will be created on first save", fixable: true, data: { path: memPath } });
  }

  // audit.jsonl
  const auditPath = path.join(memDir, "audit.jsonl");
  if (!existsSync(auditPath)) {
    out.push({ id: "memory.audit", severity: "info", message: "audit.jsonl will be created on first tool call", fixable: true, data: { path: auditPath } });
  } else {
    try {
      accessSync(auditPath, constants.W_OK);
      out.push({ id: "memory.audit", severity: "ok", message: "audit.jsonl is writable", fixable: false });
    } catch {
      out.push({ id: "memory.audit", severity: "fail", message: "audit.jsonl is not writable", fixable: false, data: { path: auditPath } });
    }
  }
  return out;
}

function checkMcpServerBinary(): CheckResult {
  const mcpServerPath = path.join(process.cwd(), "bin", "mcp-server.ts");
  if (existsSync(mcpServerPath)) {
    return { id: "mcp.server_binary", severity: "ok", message: "bin/mcp-server.ts is in place", fixable: false };
  }
  return { id: "mcp.server_binary", severity: "warn", message: "bin/mcp-server.ts missing", detail: "External MCP clients cannot connect to PandaClaw's tools.", fixable: false };
}

function checkSkills(): CheckResult {
  const skillsDir = path.join(os.homedir(), ".pandaclaw", "skills");
  if (existsSync(skillsDir)) {
    const count = readdirSync(skillsDir).filter((d) => !d.startsWith(".")).length;
    return { id: "skills.dir", severity: "ok", message: `${count} skill(s) installed in ${skillsDir}`, fixable: false, data: { count } };
  }
  return { id: "skills.dir", severity: "info", message: "No skills installed", detail: "Run `pandaclaw skills install <name>` to add a skill.", fixable: false };
}

// ──────────────────────────────────────────────────────────────────────────
// Top-level: compose all checks.
// ──────────────────────────────────────────────────────────────────────────

export function runChecks(): DoctorReport {
  const results: CheckResult[] = [];

  results.push(checkBun());

  const { cfg, result: loadResult } = checkConfig();
  results.push(loadResult);

  if (cfg) {
    results.push(...checkProviders(cfg));
    results.push(...checkRouting(cfg));
    results.push(checkSecurity(cfg));
    results.push(checkTelegram(cfg));
    results.push(checkSlack(cfg));
    results.push(...checkAgents(cfg));
    results.push(...checkMcp(cfg));
    results.push(...checkRag(cfg));
  }

  results.push(...checkMemoryDir());
  results.push(checkMcpServerBinary());
  results.push(checkSkills());

  const bv = bunVersion();
  return {
    ranAt: new Date().toISOString(),
    cwd: process.cwd(),
    bunVersion: bv,
    results,
    summary: summarize(results),
  };
}
