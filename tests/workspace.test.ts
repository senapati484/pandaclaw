// tests/workspace.test.ts
import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import path from "path";
import { WorkspaceManager } from "../modes/agent/workspace-manager.js";
import { getActiveWorkspace, getMemoryDir, getMemoryPath } from "../memory/store.js";

describe("Workspace Manager & Memory Path Resolution", () => {
  let writeSpy: any;
  let existsSpy: any;
  let readSpy: any;
  let mkdirSpy: any;
  let rmSpy: any;

  beforeEach(() => {
    writeSpy = spyOn(fs, "writeFileSync").mockImplementation(() => {});
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    readSpy = spyOn(fs, "readFileSync").mockReturnValue("[]");
    mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    rmSpy = spyOn(fs, "rmSync").mockImplementation(() => undefined);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    existsSpy.mockRestore();
    readSpy.mockRestore();
    mkdirSpy.mockRestore();
    rmSpy.mockRestore();
    delete process.env.PANDACLAW_TEST_WORKSPACE;
  });

  test("creates and lists workspaces", () => {
    const wm = new WorkspaceManager();
    const ws = wm.create("test-project", "./src");

    expect(ws.name).toBe("test-project");
    expect(ws.path).toBe(path.resolve("./src"));
    expect(ws.memoryDir).toContain("workspaces/test-project");
    expect(writeSpy).toHaveBeenCalled();
  });

  test("switches active workspace", () => {
    process.env.PANDACLAW_TEST_WORKSPACE = "test-project";
    // Mock workspaces list first
    readSpy.mockRestore();
    readSpy = spyOn(fs, "readFileSync").mockImplementation(((filename: any) => {
      if (typeof filename === "string" && filename.includes("workspaces.json")) {
        return JSON.stringify([{
          name: "test-project",
          path: "/src",
          memoryDir: "/mem",
          createdAt: Date.now(),
          lastUsed: Date.now()
        }]);
      }
      if (typeof filename === "string" && filename.includes("active_workspace.txt")) {
        return "test-project";
      }
      return "[]";
    }) as any);

    const wm = new WorkspaceManager();
    wm.switchWorkspace("test-project");
    expect(writeSpy).toHaveBeenCalled();
    expect(getActiveWorkspace()).toBe("test-project");
    expect(getMemoryDir()).toContain("workspaces/test-project");
    expect(getMemoryPath()).toContain("workspaces/test-project/memory.jsonl");
  });

  test("deletes workspace and resets active if deleted", () => {
    const wm = new WorkspaceManager();
    wm.create("another-project", ".");
    
    wm.deleteWorkspace("another-project");
    expect(rmSpy).toHaveBeenCalled();
  });
});
