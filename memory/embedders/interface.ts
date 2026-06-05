// memory/embedders/interface.ts
// Pluggable embedder interface. Multiple backends can implement this:
//   - TFIDFEmbedder (default, no deps)
//   - XenovaEmbedder (uses @xenova/transformers for real semantic vectors)

export interface Embedder {
  readonly name: string;
  readonly dim: number;
  /** Convert text into a fixed-dimension vector. */
  embed(text: string): Promise<Float32Array>;
  /** Synchronous batch helper for tests (defaults to async loop). */
  embedBatchSync?(texts: string[]): Float32Array[];
  /** Returns a backend fingerprint used to detect dimension mismatches. */
  fingerprint(): string;
}

export async function cosineSimilarity(a: Float32Array, b: Float32Array): Promise<number> {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
