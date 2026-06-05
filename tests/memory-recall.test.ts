// tests/memory-recall.test.ts
// Verifies the memory_recall tool uses RAG correctly.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { memoryRecallTool } from "../tools/memory_recall.ts";
import { RAGStore } from "../memory/vector-store.ts";
import { TFIDFEmbedder } from "../memory/embedders/tfidf.ts";
import { setRAGStore } from "../memory/rag.ts";
import { mkdtempSync, rmSync } from "fs";
import path from "path";
import * as os from "os";

describe("memory_recall tool", () => {
  let tmpDir: string;
  let store: RAGStore;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pandaclaw-memrec-"));
    const dbPath = path.join(tmpDir, "rag.db");
    const embedder = new TFIDFEmbedder(128);
    embedder.fit([
      "pandas eat bamboo in the forest",
      "python is a programming language",
      "javascript is for the browser",
      "rust provides memory safety",
    ]);
    store = new RAGStore({ dbPath, embedder });
    await store.ingest("pandas eat bamboo shoots in the wild", { topic: "animals" });
    await store.ingest("python supports asyncio for async programming", { topic: "languages" });
    await store.ingest("the rust language prevents data races at compile time", { topic: "languages" });

    // Inject the test store as the singleton so memory_recall uses it
    setRAGStore(store);
  });

  afterAll(() => {
    store.close();
    setRAGStore(null);
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test("returns hits for a relevant query", async () => {
    const result = await memoryRecallTool.execute(
      { query: "what do pandas eat" },
      { channel: "cli", requestConsent: async () => true, workspacePath: process.cwd() }
    );
    expect((result as any).hits.length).toBeGreaterThan(0);
    expect((result as any).hits[0].text).toContain("bamboo");
  });

  test("respects k parameter", async () => {
    const result = await memoryRecallTool.execute(
      { query: "programming language", k: 1 },
      { channel: "cli", requestConsent: async () => true, workspacePath: process.cwd() }
    );
    expect((result as any).hits.length).toBeLessThanOrEqual(1);
  });

  test("returns empty hits with friendly message for no matches above threshold", async () => {
    const result = await memoryRecallTool.execute(
      { query: "quantum entanglement in deep space", minScore: 0.99 },
      { channel: "cli", requestConsent: async () => true, workspacePath: process.cwd() }
    );
    expect((result as any).message).toBeDefined();
  });

  test("requires query parameter", async () => {
    await expect(
      memoryRecallTool.execute(
        { k: 5 },
        { channel: "cli", requestConsent: async () => true, workspacePath: process.cwd() }
      )
    ).rejects.toThrow(/query/);
  });
});
