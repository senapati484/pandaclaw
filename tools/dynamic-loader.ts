import { readdirSync, existsSync } from "fs";
import path from "path";
import type { ToolDefinition } from "../modes/agent/types.js";

/**
 * Scans the 'skills/' directory in the workspace, dynamically imports
 * any TS/JS skills, and returns them as a map of ToolDefinitions.
 */
export async function loadDynamicSkills(workspacePath: string): Promise<Record<string, ToolDefinition>> {
  const skillsDir = path.resolve(workspacePath, "skills");
  const loaded: Record<string, ToolDefinition> = {};

  if (!existsSync(skillsDir)) {
    return loaded;
  }

  // Recursive directory scanner
  const getFiles = (dir: string): string[] => {
    const entries = readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
        // Skip definition or test files
        if (entry.name.endsWith(".d.ts") || entry.name.endsWith(".test.ts")) continue;
        files.push(fullPath);
      }
    }
    return files;
  };

  try {
    const files = getFiles(skillsDir);
    for (const file of files) {
      try {
        const mod = await import(file);
        const skill = mod.skill as ToolDefinition;
        if (skill && skill.name && typeof skill.execute === "function") {
          loaded[skill.name] = skill;
        }
      } catch (err: any) {
        console.warn(`[dynamic-loader] Failed to load skill from ${file}: ${err.message}`);
      }
    }
  } catch (err: any) {
    console.warn(`[dynamic-loader] Error reading skills directory: ${err.message}`);
  }

  return loaded;
}
