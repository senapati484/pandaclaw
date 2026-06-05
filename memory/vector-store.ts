// memory/vector-store.ts
// SQLite-backed vector store using bun:sqlite. Stores Float32Array vectors
// as BLOBs along with metadata. Performs brute-force cosine similarity search
// (sufficient for thousands of documents on a personal-assistant scale).

import { Database } from "bun:sqlite";
import { dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import type { Embedder } from "./embedders/interface.js";
import { cosineSimilarity } from "./embedders/interface.js";

export interface VectorRow {
  id: number;
  text: string;
  metadata: string | null; // JSON
  embedding: Float32Array;
  createdAt: number;
}

export interface SearchResult {
  id: number;
  text: string;
  metadata: Record<string, unknown> | null;
  score: number;
  createdAt: number;
}

export interface RAGStoreOptions {
  dbPath: string;
  embedder: Embedder;
  // Optional callback for lifecycle events (useful for tests / logging)
  onError?: (err: Error) => void;
}

export class RAGStore {
  private db: Database;
  private fingerprint: string;
  private insertStmt: ReturnType<Database["prepare"]> | null = null;
  private allStmt: ReturnType<Database["prepare"]> | null = null;
  private countStmt: ReturnType<Database["prepare"]> | null = null;
  private clearStmt: ReturnType<Database["prepare"]> | null = null;
  private deleteStmt: ReturnType<Database["prepare"]> | null = null;

  constructor(public readonly options: RAGStoreOptions) {
    const dir = dirname(options.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(options.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");

    this.fingerprint = options.embedder.fingerprint();
    this.initSchema();
    this.prepareStatements();
  }

  get embedder(): Embedder {
    return this.options.embedder;
  }

  get dim(): number {
    return this.options.embedder.dim;
  }

  close(): void {
    this.db.close();
  }

  // ============ Schema ============

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        metadata TEXT,
        embedding BLOB NOT NULL,
        embedding_dim INTEGER NOT NULL,
        embedder_fp TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rag_created_at ON rag_documents(created_at);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rag_embedder_fp ON rag_documents(embedder_fp);
    `);
  }

  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO rag_documents (text, metadata, embedding, embedding_dim, embedder_fp, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.allStmt = this.db.prepare(`SELECT id, text, metadata, embedding, created_at FROM rag_documents`);
    this.countStmt = this.db.prepare(`SELECT COUNT(*) as c FROM rag_documents`);
    this.clearStmt = this.db.prepare(`DELETE FROM rag_documents`);
    this.deleteStmt = this.db.prepare(`DELETE FROM rag_documents WHERE id = ?`);
  }

  // ============ Ingest ============

  async ingest(text: string, metadata?: Record<string, unknown>): Promise<number> {
    const vec = await this.embedder.embed(text);
    return this.insertVector(text, vec, metadata);
  }

  async ingestBatch(
    texts: string[],
    metadatas?: (Record<string, unknown> | undefined)[]
  ): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      const vec = await this.embedder.embed(texts[i]!);
      const id = this.insertVector(texts[i]!, vec, metadatas?.[i]);
      ids.push(id);
    }
    return ids;
  }

  private insertVector(text: string, vec: Float32Array, metadata?: Record<string, unknown>): number {
    const blob = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
    const metaJson = metadata ? JSON.stringify(metadata) : null;
    const result = this.insertStmt!.run(text, metaJson, blob, vec.length, this.fingerprint, Date.now());
    return Number(result.lastInsertRowid);
  }

  // ============ Search ============

  async search(query: string, k = 5, minScore = 0.0): Promise<SearchResult[]> {
    const queryVec = await this.embedder.embed(query);
    return this.searchByVector(queryVec, k, minScore);
  }

  async searchByVector(queryVec: Float32Array, k = 5, minScore = 0.0): Promise<SearchResult[]> {
    if (queryVec.length !== this.dim) {
      throw new Error(`Query vector dim ${queryVec.length} != store dim ${this.dim}`);
    }
    const rows = this.allStmt!.all() as any[];
    const scored: SearchResult[] = [];
    for (const row of rows) {
      const vec = this.blobToVector(row.embedding);
      const score = await cosineSimilarity(queryVec, vec);
      if (score < minScore) continue;
      scored.push({
        id: row.id,
        text: row.text,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        score,
        createdAt: row.created_at,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  // ============ Maintenance ============

  count(): number {
    const row = this.countStmt!.get() as any;
    return row.c as number;
  }

  clear(): void {
    this.clearStmt!.run();
  }

  delete(id: number): boolean {
    const r = this.deleteStmt!.run(id);
    return r.changes > 0;
  }

  // ============ Bulk Operations ============

  /**
   * Ingest each non-empty line from a JSONL file. Each line is parsed as
   * `{ text: string, metadata?: object }`.
   * Returns the number of rows ingested.
   */
  async ingestJSONL(jsonlText: string): Promise<number> {
    const lines = jsonlText.split("\n").filter((l) => l.trim().length > 0);
    const texts: string[] = [];
    const metas: (Record<string, unknown> | undefined)[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (typeof obj.text === "string" && obj.text.length > 0) {
          texts.push(obj.text);
          metas.push(obj.metadata);
        }
      } catch {
        // skip malformed lines
      }
    }
    const ids = await this.ingestBatch(texts, metas);
    return ids.length;
  }

  /**
   * Drop all rows that were embedded with a different embedder. Useful when
   * upgrading from TFIDF to Xenova — old vectors would have different dim.
   */
  purgeStaleEmbeddings(): number {
    const stmt = this.db.prepare(`DELETE FROM rag_documents WHERE embedder_fp != ?`);
    const r = stmt.run(this.fingerprint);
    return r.changes;
  }

  // ============ Helpers ============

  private blobToVector(blob: Uint8Array | Buffer): Float32Array {
    // The blob is the raw bytes of a Float32Array
    return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  }
}
