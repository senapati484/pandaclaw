import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

export type FormatterType = "prettier" | "biome" | "eslint" | "dprint" | "none";

export interface FormatterConfig {
  type: FormatterType;
  command: string;
  args: string[];
  extensions: string[];
}

export function detectFormatter(projectRoot: string): FormatterConfig {
  // Check for Biome (highest priority — fastest)
  if (existsSync(resolve(projectRoot, "biome.json")) || existsSync(resolve(projectRoot, "biome.jsonc"))) {
    return {
      type: "biome",
      command: "npx",
      args: ["biome", "format", "--write"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".css"],
    };
  }

  // Check for dprint
  if (existsSync(resolve(projectRoot, "dprint.json")) || existsSync(resolve(projectRoot, ".dprint.json"))) {
    return {
      type: "dprint",
      command: "npx",
      args: ["dprint", "fmt"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css"],
    };
  }

  // Check for Prettier
  const prettierConfigs = [".prettierrc", ".prettierrc.json", ".prettierrc.js", ".prettierrc.yaml", ".prettierrc.toml", "prettier.config.js"];
  const hasPrettier = prettierConfigs.some((c) => existsSync(resolve(projectRoot, c)));
  if (hasPrettier) {
    return {
      type: "prettier",
      command: "npx",
      args: ["prettier", "--write"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css", ".yml", ".yaml"],
    };
  }

  // Check for ESLint with auto-fix
  const eslintConfigs = [".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.yaml", "eslint.config.js"];
  const hasEslint = eslintConfigs.some((c) => existsSync(resolve(projectRoot, c)));
  if (hasEslint) {
    return {
      type: "eslint",
      command: "npx",
      args: ["eslint", "--fix"],
      extensions: [".ts", ".tsx", ".js", ".jsx"],
    };
  }

  return { type: "none", command: "", args: [], extensions: [] };
}

export function formatFile(filePath: string, config: FormatterConfig): { formatted: boolean; output?: string; error?: string } {
  if (config.type === "none") {
    return { formatted: false };
  }

  const ext = filePath.slice(filePath.lastIndexOf("."));
  if (!config.extensions.includes(ext)) {
    return { formatted: false };
  }

  if (!existsSync(filePath)) {
    return { formatted: false, error: "File does not exist" };
  }

  try {
    const fullCommand = [config.command, ...config.args, filePath].join(" ");
    const output = execSync(fullCommand, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
      stdio: "pipe",
    }).trim();

    return { formatted: true, output };
  } catch (err: any) {
    return { formatted: false, error: err.stderr || err.message };
  }
}

export function formatCode(
  code: string,
  filePath: string,
  projectRoot: string
): { formatted: string; formatter: FormatterType } {
  const config = detectFormatter(projectRoot);
  if (config.type === "none") {
    return { formatted: code, formatter: "none" };
  }

  // Write to temp file, format, read back
  const tmpPath = resolve(projectRoot, ".pandaclaw", `.fmt-tmp-${Date.now()}${filePath.slice(filePath.lastIndexOf("."))}`);
  try {
    require("fs").writeFileSync(tmpPath, code, "utf8");
    const result = formatFile(tmpPath, config);

    if (result.formatted) {
      const formatted = require("fs").readFileSync(tmpPath, "utf8");
      require("fs").unlinkSync(tmpPath);
      return { formatted, formatter: config.type };
    }

    require("fs").unlinkSync(tmpPath);
    return { formatted: code, formatter: "none" };
  } catch {
    try { require("fs").unlinkSync(tmpPath); } catch {}
    return { formatted: code, formatter: "none" };
  }
}

export function formatAfterMutation(filePath: string, projectRoot: string): { formatted: boolean; formatter: string } {
  const config = detectFormatter(projectRoot);
  if (config.type === "none") {
    return { formatted: false, formatter: "none" };
  }

  const result = formatFile(filePath, config);
  return {
    formatted: result.formatted,
    formatter: config.type,
  };
}
