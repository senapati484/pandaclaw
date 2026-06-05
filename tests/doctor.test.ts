// tests/doctor.test.ts
// Unit tests for the doctor module — checks + fixer.

import { describe, expect, test, beforeAll, afterAll, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import * as os from "os";
import * as aiConfig from "../ai/ai.config.ts";

const REPO_ROOT = path.join(import.meta.dir, "..");
const TMP = path.join(os.tmpdir(), `pandaclaw-doctor-${process.pid}`);

let originalEnv: NodeJS.ProcessEnv;

beforeAll(() => {
  originalEnv = { ...process.env };
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  process.env = originalEnv;
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

const sampleConfig = {
  providers: {
    groq: { api_key: "test-key", api_base: "https://api.groq.com" },
    openrouter: { api_key: "", api_base: "https://openrouter.ai" },
    nvidia_nim: { api_key: "", api_base: "https://nim" },
    ollama: { api_key: "ollama", api_base: "http://127.0.0.1:11434/v1" },
  },
  routing: {
    fast_path: { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1, maxTokens: 2048 },
  },
  agents: {
    default: "main",
    list: [
      { id: "main", bindings: ["telegram:*"] },
    ],
  },
};

describe("runChecks()", () => {
  test("returns a structured report with summary", async () => {
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue(sampleConfig as any);
    try {
      const { runChecks } = await import("../modes/doctor/checks.ts");
      const report = runChecks();
      expect(report.ranAt).toBeTruthy();
      expect(report.bunVersion).toBeTruthy();
      expect(Array.isArray(report.results)).toBe(true);
      expect(report.summary.total).toBe(report.results.length);
      expect(report.summary.ok + report.summary.warn + report.summary.fail + report.summary.info).toBe(report.summary.total);

      const loadCheck = report.results.find((r) => r.id === "config.load");
      expect(loadCheck?.severity).toBe("ok");
    } finally {
      spy.mockRestore();
    }
  });

  test("flags missing config as a failure", async () => {
    const spy = spyOn(aiConfig, "readConfig").mockImplementation(() => {
      throw new Error("config.json not found. Please run \"pandaclaw setup\" to configure your API keys.");
    });
    try {
      const { runChecks } = await import("../modes/doctor/checks.ts");
      const report = runChecks();
      const loadCheck = report.results.find((r) => r.id === "config.load");
      expect(loadCheck?.severity).toBe("fail");
      expect(loadCheck?.message).toContain("config.json");
    } finally {
      spy.mockRestore();
    }
  });

  test("flags a bad Telegram token as a warning", async () => {
    const cfg = JSON.parse(JSON.stringify(sampleConfig));
    cfg.telegram = { token: "this-is-not-a-valid-token" };
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue(cfg as any);
    try {
      const { runChecks } = await import("../modes/doctor/checks.ts");
      const report = runChecks();
      const tg = report.results.find((r) => r.id === "config.telegram");
      expect(tg?.severity).toBe("warn");
    } finally {
      spy.mockRestore();
    }
  });

  test("warns when no default agent is set", async () => {
    const cfg = JSON.parse(JSON.stringify(sampleConfig));
    cfg.agents = { default: undefined, list: [{ id: "ops", bindings: [] }, { id: "work", bindings: [] }] };
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue(cfg as any);
    try {
      const { runChecks } = await import("../modes/doctor/checks.ts");
      const report = runChecks();
      const def = report.results.find((r) => r.id === "config.agents.default");
      expect(def?.severity).toBe("warn");
      expect(def?.fixable).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("warns on unparseable agent bindings", async () => {
    const cfg = JSON.parse(JSON.stringify(sampleConfig));
    cfg.agents.list = [{ id: "ops", bindings: ["telegram:"] }]; // empty pattern after colon
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue(cfg as any);
    try {
      const { runChecks } = await import("../modes/doctor/checks.ts");
      const report = runChecks();
      const bad = report.results.find((r) => r.id === "config.agents.bindings");
      expect(bad?.severity).toBe("warn");
    } finally {
      spy.mockRestore();
    }
  });

  test("flags an MCP server with a missing command", async () => {
    const cfg = JSON.parse(JSON.stringify(sampleConfig));
    cfg.mcp = { enabled: true, servers: [{ name: "fake", command: "definitely-not-on-path-xyz" }] };
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue(cfg as any);
    try {
      const { runChecks } = await import("../modes/doctor/checks.ts");
      const report = runChecks();
      const mcp = report.results.find((r) => r.id === "config.mcp.fake");
      expect(mcp?.severity).toBe("fail");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("applyFixes()", () => {
  test("creates a missing memory dir", async () => {
    const { applyFixes } = await import("../modes/doctor/fixer.ts");
    const result = {
      id: "memory.dir",
      severity: "warn" as const,
      message: "missing",
      fixable: true,
      data: { path: path.join(TMP, "fix-mem") },
    };
    const summary = applyFixes({ results: [result] });
    expect(summary.succeeded).toBe(1);
    expect(existsSync(path.join(TMP, "fix-mem"))).toBe(true);
  });

  test("touches a missing memory.jsonl", async () => {
    const target = path.join(TMP, "fix-mem", "memory.jsonl");
    const { applyFixes } = await import("../modes/doctor/fixer.ts");
    const result = {
      id: "memory.jsonl",
      severity: "info" as const,
      message: "missing",
      fixable: true,
      data: { path: target },
    };
    const summary = applyFixes({ results: [result] });
    expect(summary.succeeded).toBe(1);
    expect(existsSync(target)).toBe(true);
  });

  test("touches a missing audit.jsonl", async () => {
    const target = path.join(TMP, "fix-mem", "audit.jsonl");
    const { applyFixes } = await import("../modes/doctor/fixer.ts");
    const result = {
      id: "memory.audit",
      severity: "info" as const,
      message: "missing",
      fixable: true,
      data: { path: target },
    };
    const summary = applyFixes({ results: [result] });
    expect(summary.succeeded).toBe(1);
    expect(existsSync(target)).toBe(true);
  });

  test("creates a missing RAG db file", async () => {
    const target = path.join(TMP, `fix-rag-${Date.now()}.db`);
    const { applyFixes } = await import("../modes/doctor/fixer.ts");
    const result = {
      id: "config.rag",
      severity: "info" as const,
      message: "missing",
      fixable: true,
      data: { dbPath: target },
    };
    const summary = applyFixes({ results: [result] });
    expect(summary.succeeded).toBe(1);
    expect(existsSync(target)).toBe(true);
  });

  test("idempotent — second fix on existing file is a no-op success", async () => {
    const target = path.join(TMP, `fix-rag-idem-${Date.now()}.db`);
    const { applyFixes } = await import("../modes/doctor/fixer.ts");
    const result = {
      id: "config.rag",
      severity: "info" as const,
      message: "missing",
      fixable: true,
      data: { dbPath: target },
    };
    const first = applyFixes({ results: [result] });
    expect(first.succeeded).toBe(1);
    const second = applyFixes({ results: [result] });
    expect(second.succeeded).toBe(1);
    expect(second.results[0]?.message).toContain("Already exists");
  });

  test("ignores checks that aren't fixable", async () => {
    const { applyFixes } = await import("../modes/doctor/fixer.ts");
    const results = [
      { id: "config.load", severity: "fail" as const, message: "bad config", fixable: false },
      { id: "config.telegram", severity: "warn" as const, message: "bad token", fixable: false },
    ];
    const summary = applyFixes({ results });
    expect(summary.attempted).toBe(0);
    expect(summary.unfixable).toHaveLength(2);
  });

  test("skips checks outside the requested id set", async () => {
    const { applyFixes } = await import("../modes/doctor/fixer.ts");
    const results = [
      { id: "memory.dir", severity: "warn" as const, message: "x", fixable: true, data: { path: path.join(TMP, "skip-test") } },
      { id: "memory.audit", severity: "info" as const, message: "y", fixable: true, data: { path: path.join(TMP, "skip-test", "audit.jsonl") } },
    ];
    const summary = applyFixes({ results }, { ids: ["memory.dir"] });
    expect(summary.attempted).toBe(1);
    expect(summary.succeeded).toBe(1);
  });
});

describe("doctorCommand()", () => {
  test("prints a human-readable report by default", async () => {
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue(sampleConfig as any);
    const log = console.log;
    const lines: string[] = [];
    console.log = (s: any) => lines.push(String(s));
    try {
      const { doctorCommand } = await import("../cli/doctor-cli.ts");
      const report = doctorCommand();
      expect(report).not.toBeNull();
    } finally {
      console.log = log;
      spy.mockRestore();
    }
    const out = lines.join("\n");
    expect(out).toContain("PandaClaw Doctor");
    expect(out).toContain("Summary:");
  });

  test("outputs JSON when --json is passed", async () => {
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue(sampleConfig as any);
    const log = console.log;
    let captured = "";
    console.log = (s: any) => { captured += String(s); };
    try {
      const { doctorCommand } = await import("../cli/doctor-cli.ts");
      doctorCommand({ json: true });
    } finally {
      console.log = log;
      spy.mockRestore();
    }
    const parsed = JSON.parse(captured);
    expect(parsed.ranAt).toBeTruthy();
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.summary).toBeTruthy();
  });
});
