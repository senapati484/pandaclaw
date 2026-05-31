import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import path from "path";
import { loadDynamicSkills } from "../tools/dynamic-loader.js";
import { TOOLS, initDynamicSkills } from "../tools/index.js";
import { runToolAgent } from "../modes/ask/tool-agent.js";

describe("Dynamic Skills Loader", () => {
  const tempSkillsDir = path.resolve(process.cwd(), "skills");

  beforeAll(() => {
    if (!existsSync(tempSkillsDir)) {
      mkdirSync(tempSkillsDir, { recursive: true });
    }
    // Write a mock skill without schema (fallback test)
    const skillContent = `
export const skill = {
  name: "test_dynamic_skill",
  description: "A dynamic skill for testing",
  risky: false,
  readOnly: true,
  execute: async (args) => {
    return { result: "dynamic_hello", value: args.value };
  }
};
`;
    writeFileSync(path.join(tempSkillsDir, "test-skill.ts"), skillContent, "utf8");

    // Write a mock skill with schema (explicit schema test)
    const skillWithSchemaContent = `
export const skill = {
  name: "test_dynamic_skill_with_schema",
  description: "A dynamic skill with schema for testing",
  risky: false,
  readOnly: true,
  schema: {
    type: "function",
    function: {
      name: "test_dynamic_skill_with_schema",
      description: "A dynamic skill with schema for testing",
      parameters: {
        type: "object",
        properties: {
          param1: { type: "string" }
        },
        required: ["param1"]
      }
    }
  },
  execute: async (args) => {
    return { result: "dynamic_schema_hello", value: args.param1 };
  }
};
`;
    writeFileSync(path.join(tempSkillsDir, "test-skill-schema.ts"), skillWithSchemaContent, "utf8");
  });

  afterAll(() => {
    // Cleanup mock skills
    try {
      rmSync(path.join(tempSkillsDir, "test-skill.ts"), { force: true });
      rmSync(path.join(tempSkillsDir, "test-skill-schema.ts"), { force: true });
      // Delete temporary tools keys to avoid leaking into other tests
      delete TOOLS.test_dynamic_skill;
      delete TOOLS.test_dynamic_skill_with_schema;
    } catch {}
  });

  test("loads dynamic skills from skills/ folder", async () => {
    const loaded = await loadDynamicSkills(process.cwd());
    expect(loaded.test_dynamic_skill).toBeDefined();
    expect(loaded.test_dynamic_skill.description).toBe("A dynamic skill for testing");
    expect(loaded.test_dynamic_skill.risky).toBe(false);

    const res = await loaded.test_dynamic_skill.execute({ value: 123 }, {} as any);
    expect(res).toEqual({ result: "dynamic_hello", value: 123 });
  });

  test("injects dynamic tools and schemas into tool agent LLM payload", async () => {
    // Initialize the dynamic skills loader to register tools in TOOLS
    await initDynamicSkills(process.cwd());

    expect(TOOLS.test_dynamic_skill).toBeDefined();
    expect(TOOLS.test_dynamic_skill_with_schema).toBeDefined();

    const originalFetch = globalThis.fetch;
    let capturedBody: any = null;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(String(init.body));
      }
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Completed test task."
            }
          }
        ]
      }), { status: 200 });
    }) as any;

    const mockConfig = {
      providers: {
        groq: { api_key: "test_key", api_base: "https://api.groq.com/openai/v1" }
      },
      routing: {
        fallback_chain: ["groq"]
      }
    } as any;

    const mockContext = {
      userId: "test_chat_id",
      channel: "cli",
      workspacePath: process.cwd(),
      requestConsent: async () => true
    } as any;

    try {
      await runToolAgent("Hello panda", mockConfig, mockContext);
      expect(capturedBody).toBeDefined();
      expect(capturedBody.tools).toBeDefined();

      // Find tool definitions in the sent payload
      const sentTools = capturedBody.tools as any[];
      const fallbackTool = sentTools.find(t => t.function.name === "test_dynamic_skill");
      const explicitTool = sentTools.find(t => t.function.name === "test_dynamic_skill_with_schema");

      // Verify fallback tool schema is auto-generated
      expect(fallbackTool).toBeDefined();
      expect(fallbackTool.function.description).toBe("A dynamic skill for testing");
      expect(fallbackTool.function.parameters.properties.arguments).toBeDefined();

      // Verify explicit tool schema is passed exactly
      expect(explicitTool).toBeDefined();
      expect(explicitTool.function.description).toBe("A dynamic skill with schema for testing");
      expect(explicitTool.function.parameters.properties.param1).toBeDefined();
      expect(explicitTool.function.parameters.required).toContain("param1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
