// tests/multi-agent.test.ts
// Verifies multi-agent routing: registry, binding parse, and message routing.

import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../modes/agent/agent-registry.ts";
import { AgentRouter } from "../modes/agent/agent-router.ts";
import { parseBinding, matchBinding } from "../modes/agent/binding.ts";
import type { AgentDefinition } from "../modes/agent/agent-types.ts";

describe("Binding parser", () => {
  test("parses wildcard", () => {
    const b = parseBinding("*");
    expect(b).toEqual({ raw: "*", platform: "*", pattern: "*" });
  });

  test("parses platform:chat exact id", () => {
    const b = parseBinding("telegram:-1001234567");
    expect(b).toEqual({ raw: "telegram:-1001234567", platform: "telegram", pattern: "-1001234567" });
  });

  test("parses platform:*", () => {
    const b = parseBinding("telegram:*");
    expect(b).toEqual({ raw: "telegram:*", platform: "telegram", pattern: "*" });
  });

  test("parses platform prefix (trailing *)", () => {
    const b = parseBinding("telegram:ops-*");
    expect(b).toEqual({ raw: "telegram:ops-*", platform: "telegram", pattern: "ops-*" });
  });

  test("parses bare platform as platform-wide", () => {
    const b = parseBinding("slack");
    expect(b).toEqual({ raw: "slack", platform: "slack", pattern: "*" });
  });

  test("rejects empty and malformed", () => {
    expect(parseBinding("")).toBeNull();
    expect(parseBinding(":foo")).toBeNull();
    expect(parseBinding("telegram:")).toBeNull();
  });
});

describe("Binding matcher", () => {
  test("exact match wins over prefix", () => {
    const b = parseBinding("telegram:-1001234567")!;
    expect(matchBinding(b, "telegram", "-1001234567")).toBe("exact");
    expect(matchBinding(b, "telegram", "other")).toBeNull();
  });

  test("prefix match works for trailing-asterisk patterns", () => {
    const b = parseBinding("telegram:ops-*")!;
    expect(matchBinding(b, "telegram", "ops-alerts")).toBe("prefix");
    expect(matchBinding(b, "telegram", "other-chat")).toBeNull();
  });

  test("platform match works when pattern is *", () => {
    const b = parseBinding("telegram:*")!;
    expect(matchBinding(b, "telegram", "any-chat")).toBe("platform");
    expect(matchBinding(b, "slack", "any-chat")).toBeNull();
  });

  test("wildcard matches any platform and chat", () => {
    const b = parseBinding("*")!;
    expect(matchBinding(b, "telegram", "any")).toBe("wildcard");
    expect(matchBinding(b, "slack", "any")).toBe("wildcard");
  });

  test("platform mismatch returns null", () => {
    const b = parseBinding("telegram:*")!;
    expect(matchBinding(b, "slack", "any")).toBeNull();
  });
});

describe("AgentRegistry", () => {
  test("synthesizes a default 'main' agent when config has no agents block", () => {
    const r = new AgentRegistry(null);
    const def = r.defaultAgent();
    expect(def.id).toBe("main");
    expect(def.isDefault).toBe(true);
    expect(def.bindings).toHaveLength(1);
  });

  test("loads agents from config block", () => {
    const r = new AgentRegistry({
      default: "ops",
      list: [
        { id: "main", bindings: ["telegram:default-*"] },
        { id: "ops", bindings: ["telegram:ops-*"], isDefault: true, workspace: "/tmp/ops" },
        { id: "work", bindings: ["slack:work-*"] },
      ],
    });
    expect(r.list().map((a) => a.id).sort()).toEqual(["main", "ops", "work"]);
    expect(r.defaultId()).toBe("ops");
    expect(r.defaultAgent().id).toBe("ops");
  });

  test("add() throws on duplicate id", () => {
    const r = new AgentRegistry(null);
    r.add({ id: "ops", workspacePath: "/", bindings: ["*"] });
    expect(() => r.add({ id: "ops", workspacePath: "/", bindings: [] })).toThrow(/already exists/);
  });

  test("upsert() is idempotent", () => {
    const r = new AgentRegistry(null);
    r.upsert({ id: "ops", workspacePath: "/a", bindings: [] });
    r.upsert({ id: "ops", workspacePath: "/b", bindings: ["telegram:*"] });
    const ops = r.get("ops")!;
    expect(ops.workspacePath).toBe("/b");
    expect(ops.bindings).toHaveLength(1);
  });

  test("remove() updates the default when removing the default agent", () => {
    const r = new AgentRegistry({
      default: "a",
      list: [
        { id: "a", bindings: [], isDefault: true },
        { id: "b", bindings: [] },
      ],
    });
    expect(r.defaultId()).toBe("a");
    r.remove("a");
    expect(["b", "main"]).toContain(r.defaultId());
  });

  test("expands ~ in workspace paths", () => {
    const r = new AgentRegistry({ list: [{ id: "home", workspace: "~/projects", bindings: [] }] });
    const def = r.get("home")!;
    expect(def.workspacePath).not.toContain("~");
    expect(def.workspacePath).toContain("projects");
  });
});

describe("AgentRouter", () => {
  function makeRegistry(): AgentRegistry {
    return new AgentRegistry({
      default: "main",
      list: [
        { id: "main", bindings: ["telegram:*", "slack:*"] },
        { id: "ops", bindings: ["telegram:ops-*", "slack:C0OPS123"] },
        { id: "work", bindings: ["telegram:work-*"], workspace: "/tmp/work" },
      ],
    });
  }

  test("routes exact-match chat to specific agent", () => {
    const r = new AgentRouter(makeRegistry());
    const decision = r.route("slack", "C0OPS123");
    expect(decision.agent.id).toBe("ops");
    expect(decision.reason).toBe("exact");
  });

  test("routes prefix-match chat to specific agent", () => {
    const r = new AgentRouter(makeRegistry());
    const decision = r.route("telegram", "ops-alerts");
    expect(decision.agent.id).toBe("ops");
    expect(decision.reason).toBe("prefix");
  });

  test("routes other telegram chats to the default", () => {
    const r = new AgentRouter(makeRegistry());
    const decision = r.route("telegram", "random-chat");
    expect(decision.agent.id).toBe("main");
    expect(decision.reason).toBe("platform");
  });

  test("routes unknown platforms to default via platform match", () => {
    const r = new AgentRouter(makeRegistry());
    const decision = r.route("discord", "some-channel");
    expect(decision.agent.id).toBe("main");
    expect(decision.reason).toBe("default");
  });

  test("explain() shows all matches sorted by specificity (most specific first)", () => {
    const r = new AgentRouter(makeRegistry());
    const explanation = r.explain("telegram", "ops-1234");
    // Both "ops" (prefix) and "main" (platform) match
    expect(explanation.length).toBe(2);
    expect(explanation[0]!.agent.id).toBe("ops");
    expect(explanation[0]!.reason).toBe("prefix");
    expect(explanation[1]!.agent.id).toBe("main");
    expect(explanation[1]!.reason).toBe("platform");
  });

  test("first declared binding wins for the same agent on specificity tie", () => {
    const r = new AgentRouter(
      new AgentRegistry({
        list: [
          { id: "x", bindings: ["telegram:foo", "telegram:foo*"] },
        ],
      })
    );
    const d = r.route("telegram", "foo");
    expect(d.reason).toBe("exact");
  });

  test("agentsForPlatform() lists all agents that could receive traffic from a platform", () => {
    const r = new AgentRouter(makeRegistry());
    expect(r.agentsForPlatform("telegram").map((a) => a.id).sort()).toEqual(["main", "ops", "work"]);
    expect(r.agentsForPlatform("slack").map((a) => a.id).sort()).toEqual(["main", "ops"]);
    expect(r.agentsForPlatform("discord").map((a) => a.id)).toEqual([]);
  });
});

describe("End-to-end routing scenarios", () => {
  test("OpenClaw-style: 1 telegram bot serves 3 agents via bindings", () => {
    const r = new AgentRegistry({
      default: "main",
      list: [
        { id: "main", bindings: ["telegram:*"], workspace: "/srv/main" },
        { id: "ops", bindings: ["telegram:-100OPS"], workspace: "/srv/ops", identity: { name: "Ops Bot", emoji: "🛠" } },
        { id: "personal", bindings: ["telegram:-100FAMILY"], workspace: "/srv/personal" },
      ],
    });
    const router = new AgentRouter(r);

    // Family chat
    expect(router.route("telegram", "-100FAMILY").agent.id).toBe("personal");
    // Ops chat
    expect(router.route("telegram", "-100OPS").agent.id).toBe("ops");
    // Any other chat goes to main
    expect(router.route("telegram", "-100RANDOM").agent.id).toBe("main");
  });

  test("Workspace isolation: each agent has its own cwd", () => {
    const r = new AgentRegistry({
      list: [
        { id: "main", workspace: "/srv/main", bindings: ["*"] },
        { id: "work", workspace: "/srv/work", bindings: ["slack:work-*"] },
        { id: "personal", workspace: "/srv/personal", bindings: ["telegram:family"] },
      ],
    });
    expect(r.get("main")!.workspacePath).toBe("/srv/main");
    expect(r.get("work")!.workspacePath).toBe("/srv/work");
    expect(r.get("personal")!.workspacePath).toBe("/srv/personal");
  });
});
