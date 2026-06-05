// memory/rag.ts
// High-level RAG (Retrieval-Augmented Generation) API.
// Provides a singleton RAGStore that automatically picks the best available embedder.
// Use this for indexing past sessions, code files, or any text the agent might
// want to recall later via semantic search.

import { RAGStore, type SearchResult } from "./vector-store.js";
import { TFIDFEmbedder } from "./embedders/tfidf.js";
import { XenovaEmbedder, tryXenovaEmbedder } from "./embedders/xenova.js";
import type { Embedder } from "./embedders/interface.js";
import { readConfig } from "../ai/ai.config.js";
import path from "path";
import os from "os";

export interface RAGConfig {
  /** Path to the SQLite database file. Default: ~/.pandaclaw/rag.db */
  dbPath?: string;
  /** "auto" picks the best available embedder; force a specific one with "tfidf" or "xenova". */
  embedder?: "auto" | "tfidf" | "xenova";
  /** TFIDF dimensionality. Ignored for xenova. */
  tfidfDim?: number;
}

const DEFAULT_DB_PATH = path.join(os.homedir(), ".pandaclaw", "rag.db");

// Use a globalThis-backed slot so test code can swap stores in/out
// without having to assign to ES module exports (which are read-only).
const STORE_KEY = Symbol.for("pandaclaw.ragStore");
type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: RAGStore | null };

function getSlot(): RAGStore | null {
  return (globalThis as GlobalWithStore)[STORE_KEY] ?? null;
}

function setSlot(s: RAGStore | null): void {
  (globalThis as GlobalWithStore)[STORE_KEY] = s;
}

export async function getRAGStore(config: RAGConfig = {}): Promise<RAGStore> {
  const existing = getSlot();
  if (existing) return existing;

  const dbPath = config.dbPath ?? DEFAULT_DB_PATH;
  const choice = config.embedder ?? "auto";
  let embedder: Embedder;

  if (choice === "tfidf") {
    embedder = new TFIDFEmbedder(config.tfidfDim ?? 512);
  } else if (choice === "xenova") {
    embedder = new XenovaEmbedder();
  } else {
    // auto: try xenova first (real semantic), fall back to TFIDF
    const xenova = await tryXenovaEmbedder();
    embedder = xenova ?? new TFIDFEmbedder(config.tfidfDim ?? 512);
  }

  const store = new RAGStore({ dbPath, embedder });
  setSlot(store);
  return store;
}

/**
 * Replace the singleton RAGStore. Used by tests and for re-loading with a
 * different config (e.g. after upgrading the embedder).
 */
export function setRAGStore(store: RAGStore | null): void {
  setSlot(store);
}

export async function closeRAGStore(): Promise<void> {
  const s = getSlot();
  if (s) {
    s.close();
    setSlot(null);
  }
}

/**
 * High-level search: takes a query, returns the top-k matching snippets with scores.
 */
export async function searchMemory(query: string, k = 5): Promise<SearchResult[]> {
  const store = await getRAGStore();
  return store.search(query, k);
}

/**
 * One-shot helper: index a single text into the RAG store.
 */
export async function indexText(text: string, metadata?: Record<string, unknown>): Promise<number> {
  const store = await getRAGStore();
  return store.ingest(text, metadata);
}

export { RAGStore, type SearchResult } from "./vector-store.js";
export { TFIDFEmbedder } from "./embedders/tfidf.js";
export { XenovaEmbedder, tryXenovaEmbedder, EmbedderUnavailableError } from "./embedders/xenova.js";
