// tests/agents-cli.test.ts
// Verifies the agents list / explain CLI helpers.

import { describe, expect, test, spyOn } from "bun:test";
import { agentsListCommand, agentsExplainCommand } from "../cli/agents-cli.ts";
import * as aiConfig from "../ai/ai.config.ts";

describe("agents-cli", () => {
  test("agentsListCommand prints agents from config", () => {
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue({
      agents: {
        default: "ops",
        list: [
          { id: "main", bindings: ["telegram:*"], workspace: "/srv/main" },
          { id: "ops", bindings: ["telegram:-100OPS"], isDefault: true, identity: { name: "OpsBot", emoji: "🛠" } },
        ],
      },
    } as any);
    const log = console.log;
    const lines: string[] = [];
    console.log = (...args: any[]) => lines.push(args.join(" "));
    try {
      agentsListCommand();
    } finally {
      console.log = log;
      spy.mockRestore();
    }
    const out = lines.join("\n");
    expect(out).toContain("main");
    expect(out).toContain("ops");
    expect(out).toContain("telegram:*");
    expect(out).toContain("telegram:-100OPS");
    expect(out).toContain("OpsBot");
  });

  test("agentsListCommand supports --json output", () => {
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue({
      agents: { list: [{ id: "main", bindings: ["*"] }] },
    } as any);
    const log = console.log;
    let captured = "";
    console.log = (s: any) => { captured += s; };
    try {
      agentsListCommand({ json: true });
    } finally {
      console.log = log;
      spy.mockRestore();
    }
    const parsed = JSON.parse(captured);
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0].id).toBe("main");
  });

  test("agentsExplainCommand explains routing for a chat id", () => {
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue({
      agents: {
        list: [
          { id: "main", bindings: ["telegram:*"] },
          { id: "ops", bindings: ["telegram:ops-*"] },
        ],
      },
    } as any);
    const log = console.log;
    const lines: string[] = [];
    console.log = (...args: any[]) => lines.push(args.join(" "));
    try {
      agentsExplainCommand({ platform: "telegram", chatId: "ops-alerts" });
    } finally {
      console.log = log;
      spy.mockRestore();
    }
    const out = lines.join("\n");
    expect(out).toContain("ops");
    expect(out).toContain("main");
    expect(out).toContain("prefix");
  });

  test("agentsExplainCommand supports --json output", () => {
    const spy = spyOn(aiConfig, "readConfig").mockReturnValue({
      agents: { list: [{ id: "main", bindings: ["*"] }] },
    } as any);
    const log = console.log;
    let captured = "";
    console.log = (s: any) => { captured += s; };
    try {
      agentsExplainCommand({ platform: "telegram", chatId: "x", json: true });
    } finally {
      console.log = log;
      spy.mockRestore();
    }
    const parsed = JSON.parse(captured);
    expect(parsed.platform).toBe("telegram");
    expect(parsed.winner.agent).toBe("main");
  });
});
