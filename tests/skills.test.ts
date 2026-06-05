// tests/skills.test.ts
import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import { fetchRegistry, installSkill, removeSkill, listInstalled } from "../tools/skills-manager.js";

describe("Skills Marketplace Manager", () => {
  let writeSpy: any;
  let existsSpy: any;
  let unlinkSpy: any;
  let mkdirSpy: any;
  let fetchSpy: any;

  beforeEach(() => {
    writeSpy = spyOn(fs, "writeFileSync").mockImplementation(() => {});
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
    mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    
    // Mock global fetch
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: any) => {
      if (typeof url === "string" && url.includes("registry.json")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "test-skill",
              name: "Test Skill",
              description: "For testing",
              author: "tester",
              version: "1.0.0",
              url: "https://example.com/test-skill.ts",
              tags: ["test"],
              installs: 0,
            }
          ]
        } as any;
      }
      return {
        ok: true,
        text: async () => "export const skill = { name: 'test-skill', execute: () => {} };"
      } as any;
    }) as any);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    existsSpy.mockRestore();
    unlinkSpy.mockRestore();
    mkdirSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  test("fetches registry successfully", async () => {
    const list = await fetchRegistry();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe("test-skill");
  });

  test("installs a skill from registry ID", async () => {
    const filename = await installSkill("test-skill");
    expect(filename).toBe("test-skill.ts");
    expect(writeSpy).toHaveBeenCalled();
  });

  test("installs a skill from custom URL", async () => {
    const filename = await installSkill("https://raw.githubusercontent.com/user/repo/main/my-custom-skill.ts");
    expect(filename).toBe("my-custom-skill.ts");
    expect(writeSpy).toHaveBeenCalled();
  });

  test("removes skill", () => {
    const ok = removeSkill("test-skill");
    expect(ok).toBe(true);
    expect(unlinkSpy).toHaveBeenCalled();
  });
});
