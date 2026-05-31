import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import path from "path";
import { loadDynamicSkills } from "../tools/dynamic-loader.js";

describe("Dynamic Skills Loader", () => {
  const tempSkillsDir = path.resolve(process.cwd(), "skills");

  beforeAll(() => {
    if (!existsSync(tempSkillsDir)) {
      mkdirSync(tempSkillsDir, { recursive: true });
    }
    // Write a mock skill
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
  });

  afterAll(() => {
    // Cleanup mock skill
    try {
      rmSync(path.join(tempSkillsDir, "test-skill.ts"), { force: true });
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
});
