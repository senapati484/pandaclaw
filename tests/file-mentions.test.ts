import { test, expect, describe, beforeAll } from "bun:test";
import { FileMentionResolver, extractFileMentions } from "../tools/file-mentions";

describe("FileMentionResolver", () => {
  let resolver: FileMentionResolver;

  beforeAll(() => {
    resolver = new FileMentionResolver(process.cwd());
    resolver.refresh();
  });

  test("resolves @index to at least one file", () => {
    const results = resolver.resolve("@index");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.path.includes("index"))).toBe(true);
  });

  test("resolves @config to config files", () => {
    const results = resolver.resolve("@config");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.path.includes("config"))).toBe(true);
  });

  test("returns empty for unknown @mention", () => {
    const results = resolver.resolve("@xyznonexistentfile12345");
    expect(results.length).toBe(0);
  });

  test("returns empty for non-mention input", () => {
    const results = resolver.resolve("just a normal query without at sign");
    expect(results.length).toBe(0);
  });

  test("scores exact filename match highest", () => {
    const results = resolver.resolve("@index.ts");
    if (results.length > 0 && results[0]) {
      expect(results[0].score).toBeGreaterThanOrEqual(75);
    }
  });

  test("returns project files grouped by extension", () => {
    const tsFiles = resolver.getProjectFiles(".ts");
    expect(tsFiles.length).toBeGreaterThan(0);
    for (const f of tsFiles) {
      expect(f.endsWith(".ts")).toBe(true);
    }
  });

  test("getImportableFiles returns TS/TSX/JS/JSX files", () => {
    const files = resolver.getImportableFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const valid = f.path.endsWith(".ts") || f.path.endsWith(".tsx") || f.path.endsWith(".js") || f.path.endsWith(".jsx");
      expect(valid).toBe(true);
    }
  });

  test("extractFileMentions finds @mentions in text", () => {
    const text = "Check @index.ts and @config.json for the settings";
    const mentions = extractFileMentions(text);
    expect(mentions).toContain("index.ts");
    expect(mentions).toContain("config.json");
  });

  test("extractFileMentions returns empty for text without @", () => {
    const text = "no mentions here";
    const mentions = extractFileMentions(text);
    expect(mentions.length).toBe(0);
  });

  test("resolveBestMatch picks the closest file", () => {
    const best = resolver.resolveBestMatch("index.ts");
    expect(best).not.toBeNull();
    expect(best).toContain("index.ts");
  });
});
