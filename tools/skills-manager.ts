// tools/skills-manager.ts
// Marketplace skills downloader and manager for PandaClaw.

import { existsSync, readdirSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";

const REGISTRY_URL = "https://pandaclaw.vercel.app/skills/registry.json";
const HOME = os.homedir();
const GLOBAL_SKILLS_DIR = path.join(HOME, ".pandaclaw", "skills");

export interface RegistrySkill {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  url: string;
  tags: string[];
  installs: number;
}

export async function fetchRegistry(): Promise<RegistrySkill[]> {
  try {
    const res = await fetch(REGISTRY_URL);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.json() as RegistrySkill[];
  } catch (err: any) {
    // Return a mock registry as fallback if server is offline or not created yet
    return [
      {
        id: "daily-briefing",
        name: "Daily Briefing",
        description: "Morning summary of news, weather, and calendar",
        author: "senapati484",
        version: "1.0.0",
        url: "https://gist.githubusercontent.com/senapati484/e0066f1207e0c8de6461a2936a7e0c4b/raw/daily-briefing.ts",
        tags: ["productivity", "morning", "news"],
        installs: 342,
      },
      {
        id: "system-cleaner",
        name: "System Cleaner",
        description: "Scans and cleans temporary files and caches safely",
        author: "pandaclaw-dev",
        version: "1.1.0",
        url: "https://gist.githubusercontent.com/pandaclaw-dev/f8d839dae8c71b1238ea98c1b2c45b8e/raw/system-cleaner.ts",
        tags: ["system", "cleanup"],
        installs: 189,
      }
    ];
  }
}

export async function installSkill(idOrUrl: string): Promise<string> {
  if (!existsSync(GLOBAL_SKILLS_DIR)) {
    mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
  }

  let downloadUrl = idOrUrl;
  let filename = "";

  if (idOrUrl.startsWith("http://") || idOrUrl.startsWith("https://")) {
    // Parse Gist URL to raw link
    if (idOrUrl.includes("gist.github.com") && !idOrUrl.includes("/raw")) {
      downloadUrl = idOrUrl + "/raw";
    }
    const urlParts = idOrUrl.split("/");
    filename = urlParts[urlParts.length - 1]!.split("?")[0] || "custom-skill.ts";
    if (!filename.endsWith(".ts") && !filename.endsWith(".js")) {
      filename += ".ts";
    }
  } else {
    // Registry ID lookup
    const registry = await fetchRegistry();
    const skill = registry.find(s => s.id === idOrUrl.toLowerCase().trim());
    if (!skill) {
      throw new Error(`Skill with ID "${idOrUrl}" not found in community registry.`);
    }
    downloadUrl = skill.url;
    filename = `${skill.id}.ts`;
  }

  const targetPath = path.join(GLOBAL_SKILLS_DIR, filename);

  console.log(chalk.gray(`  Downloading skill from ${downloadUrl}...`));
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download skill (${res.status}): ${res.statusText}`);
  }

  const code = await res.text();
  
  // Basic safety check for syntax or empty payload
  if (!code.trim() || code.includes("<!DOCTYPE html>") || code.includes("<html")) {
    throw new Error("Downloaded file is invalid or returned an HTML error page instead of raw code.");
  }

  writeFileSync(targetPath, code, "utf8");
  return filename;
}

export function removeSkill(id: string): boolean {
  const cleanId = id.toLowerCase().trim();
  const file1 = path.join(GLOBAL_SKILLS_DIR, `${cleanId}.ts`);
  const file2 = path.join(GLOBAL_SKILLS_DIR, `${cleanId}.js`);

  let removed = false;
  if (existsSync(file1)) {
    unlinkSync(file1);
    removed = true;
  }
  if (existsSync(file2)) {
    unlinkSync(file2);
    removed = true;
  }

  return removed;
}

export function listInstalled(): string[] {
  if (!existsSync(GLOBAL_SKILLS_DIR)) return [];
  try {
    return readdirSync(GLOBAL_SKILLS_DIR)
      .filter(f => (f.endsWith(".ts") || f.endsWith(".js")) && !f.endsWith(".d.ts") && !f.endsWith(".test.ts"));
  } catch {
    return [];
  }
}
