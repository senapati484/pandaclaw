// tests/rag.test.ts
// Verifies the RAG store, embedders, and end-to-end retrieval.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { RAGStore } from "../memory/vector-store.ts";
import { TFIDFEmbedder } from "../memory/embedders/tfidf.ts";
import { XenovaEmbedder, tryXenovaEmbedder } from "../memory/embedders/xenova.ts";
import { tokenize, bigrams } from "../memory/tokenizer.ts";
import { cosineSimilarity } from "../memory/embedders/interface.ts";
import { mkdtempSync, rmSync } from "fs";
import path from "path";
import os from "os";

describe("Tokenizer", () => {
  test("lowercases and strips punctuation", () => {
    const tokens = tokenize("Hello, World! The PANDA eats bamboo.");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("panda");
    expect(tokens).toContain("eats");
    expect(tokens).toContain("bamboo");
  });

  test("filters out stop words", () => {
    const tokens = tokenize("the cat is on a mat");
    expect(tokens).toContain("cat");
    expect(tokens).toContain("mat");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("is");
    expect(tokens).not.toContain("a");
  });

  test("bigrams combine adjacent tokens", () => {
    const bigramsResult = bigrams(["machine", "learning", "model"]);
    expect(bigramsResult).toEqual(["machine_learning", "learning_model"]);
  });
});

describe("Cosine similarity", () => {
  test("identical vectors return 1.0", async () => {
    const v = new Float32Array([1, 2, 3]);
    expect(await cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  test("orthogonal vectors return 0.0", async () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(await cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  test("opposite vectors return -1.0", async () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([-1, -2]);
    expect(await cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });
});

describe("TFIDFEmbedder", () => {
  test("produces normalized fixed-dim vectors", async () => {
    const e = new TFIDFEmbedder(64);
    const v = await e.embed("hello world");
    expect(v.length).toBe(64);
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 4);
  });

  test("identical inputs produce identical vectors", async () => {
    const e = new TFIDFEmbedder(64);
    const a = await e.embed("the panda eats");
    const b = await e.embed("the panda eats");
    expect(await cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  test("similar topics score higher than unrelated ones", async () => {
    const e = new TFIDFEmbedder(256);
    e.fit([
      "the panda eats bamboo in the forest",
      "python is a programming language for machine learning",
      "javascript runs in the browser and node js",
    ]);
    const query = await e.embed("what do pandas eat");
    const bamboo = await e.embed("pandas eat bamboo in forests");
    const python = await e.embed("python programming language");
    const pandaScore = await cosineSimilarity(query, bamboo);
    const pythonScore = await cosineSimilarity(query, python);
    expect(pandaScore).toBeGreaterThan(pythonScore);
  });

  test("fingerprint includes dim and doc count", () => {
    const e = new TFIDFEmbedder(128);
    expect(e.fingerprint()).toBe("tfidf:128:0");
    e.fit(["a b c", "d e f"]);
    expect(e.fingerprint()).toBe("tfidf:128:2");
  });
});

describe("RAGStore (TFIDF backend)", () => {
  let tmpDir: string;
  let store: RAGStore;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pandaclaw-rag-"));
    const dbPath = path.join(tmpDir, "rag.db");
    const embedder = new TFIDFEmbedder(128);
    embedder.fit([
      "the panda eats bamboo in the forest",
      "python is a programming language for machine learning",
      "javascript runs in the browser and node js",
      "rust provides memory safety without garbage collection",
      "sqlite is a lightweight relational database",
    ]);
    store = new RAGStore({ dbPath, embedder });
  });

  afterAll(() => {
    store.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test("ingest and count", async () => {
    expect(store.count()).toBe(0);
    await store.ingest("pandas eat bamboo shoots in the wild", { source: "test" });
    await store.ingest("the python language supports asyncio", { source: "test" });
    expect(store.count()).toBe(2);
  });

  test("search returns relevant results ranked by score", async () => {
    const results = await store.search("what do pandas eat", 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.text).toContain("bamboo");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  test("metadata round-trips through the store", async () => {
    const id = await store.ingest("the rust language is fast", { topic: "rust", year: 2024 });
    const results = await store.search("rust language", 1);
    expect(results[0]!.metadata).toEqual({ topic: "rust", year: 2024 });
    expect(id).toBeGreaterThan(0);
  });

  test("minScore filters out low-similarity results", async () => {
    const results = await store.search("completely unrelated quantum physics", 5, 0.9);
    // May be empty since "quantum" tokens are not in any indexed document
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.9);
    }
  });

  test("ingestBatch ingests multiple rows in one call", async () => {
    const before = store.count();
    await store.ingestBatch(["row a", "row b", "row c"]);
    expect(store.count() - before).toBe(3);
  });

  test("ingestJSONL parses and ingests", async () => {
    const before = store.count();
    const jsonl = [
      JSON.stringify({ text: "jsonl row one", metadata: { src: "jsonl" } }),
      JSON.stringify({ text: "jsonl row two" }),
      "garbage line that should be skipped",
      JSON.stringify({ text: "jsonl row three" }),
    ].join("\n");
    const n = await store.ingestJSONL(jsonl);
    expect(n).toBe(3);
    expect(store.count() - before).toBe(3);
  });

  test("delete removes a single row", async () => {
    const before = store.count();
    const id = await store.ingest("delete me please");
    expect(store.count()).toBe(before + 1);
    const ok = store.delete(id);
    expect(ok).toBe(true);
    expect(store.count()).toBe(before);
  });

  test("clear removes all rows", async () => {
    store.clear();
    expect(store.count()).toBe(0);
  });

  test("purgeStaleEmbeddings drops rows from a different embedder", async () => {
    await store.ingest("test row");
    const before = store.count();
    // create another store with a different embedder (different dim)
    const otherStore = new RAGStore({
      dbPath: path.join(tmpDir, "rag.db"), // same file
      embedder: new TFIDFEmbedder(256), // different dim => different fingerprint
    });
    const purged = otherStore.purgeStaleEmbeddings();
    expect(purged).toBe(before);
    expect(otherStore.count()).toBe(0);
    otherStore.close();
  });
});

describe("XenovaEmbedder (optional, only runs if @xenova/transformers is installed)", () => {
  test("tryXenovaEmbedder returns instance or null", async () => {
    const e = await tryXenovaEmbedder();
    if (e === null) {
      // Package not installed — that's fine, the auto-pick in getRAGStore handles it
      expect(e).toBeNull();
    } else {
      expect(e).toBeInstanceOf(XenovaEmbedder);
      expect(e.dim).toBe(384);
    }
  });

  test("embed produces 384-dim normalized vector (if available)", async () => {
    const e = await tryXenovaEmbedder();
    if (e === null) {
      // skip
      return;
    }
    const v = await e.embed("hello world");
    expect(v.length).toBe(384);
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 3);
  }, 60_000);
});
