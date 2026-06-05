// memory/embedders/tfidf.ts
// TF-IDF embedder — pure JS, no external dependencies.
// Hashing trick: maps each token to one of `dim` buckets so vector size is fixed
// regardless of vocabulary. Captures lexical similarity (not semantic),
// but is fast, deterministic, and works offline.

import type { Embedder } from "./interface.js";
import { tokenize } from "../tokenizer.js";

export class TFIDFEmbedder implements Embedder {
  readonly name = "tfidf";
  readonly dim: number;
  private docCount = 0;
  private df: Map<string, number> = new Map();
  // Optionally persist a fitted IDF map across instances.
  private idf: Map<string, number> = new Map();

  constructor(dim = 512) {
    this.dim = dim;
  }

  fingerprint(): string {
    return `tfidf:${this.dim}:${this.docCount}`;
  }

  /**
   * Fit the IDF map from a corpus. This is optional — without it, all terms get
   * the same weight (1.0) and the embedder degrades gracefully to a hashed bag-of-words.
   */
  fit(documents: string[]): void {
    this.df.clear();
    this.docCount = documents.length;
    for (const doc of documents) {
      const seen = new Set(tokenize(doc));
      for (const term of seen) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
    this.idf.clear();
    for (const [term, freq] of this.df) {
      // smoothed IDF
      this.idf.set(term, Math.log((1 + this.docCount) / (1 + freq)) + 1);
    }
  }

  async embed(text: string): Promise<Float32Array> {
    return this.embedBatchSync([text])[0]!;
  }

  embedBatchSync(texts: string[]): Float32Array[] {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): Float32Array {
    const tokens = tokenize(text);
    if (tokens.length === 0) {
      return new Float32Array(this.dim);
    }
    const vec = new Float32Array(this.dim);
    const counts = new Map<string, number>();
    for (const tok of tokens) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
    for (const [term, count] of counts) {
      const idx = this.hash(term) % this.dim;
      const idf = this.idf.get(term) ?? 1.0;
      // sub-linear TF scaling
      vec[idx]! += (1 + Math.log(count)) * idf;
    }
    // L2 normalize for cosine similarity
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i]! /= norm;
    }
    return vec;
  }

  private hash(s: string): number {
    // djb2 hash — fast and well-distributed for short strings
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = (h * 33) ^ s.charCodeAt(i);
    }
    return h >>> 0;
  }
}
