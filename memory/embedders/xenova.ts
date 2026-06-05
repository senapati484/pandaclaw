// memory/embedders/xenova.ts
// Xenova embedder — uses @xenova/transformers for real semantic embeddings.
// Falls back gracefully (throws EmbedderUnavailableError) if the package is missing.

import type { Embedder } from "./interface.js";

export class EmbedderUnavailableError extends Error {
  constructor(pkg: string, reason: string) {
    super(`Embedder "${pkg}" unavailable: ${reason}`);
    this.name = "EmbedderUnavailableError";
  }
}

export class XenovaEmbedder implements Embedder {
  readonly name = "xenova";
  readonly dim: number;
  private extractor: any = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly modelName: string = "Xenova/all-MiniLM-L6-v2",
    dim = 384
  ) {
    this.dim = dim;
  }

  fingerprint(): string {
    return `xenova:${this.modelName}:${this.dim}`;
  }

  private async init(): Promise<void> {
    if (this.extractor) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      let mod: any;
      try {
        mod = await import("@xenova/transformers");
      } catch (err) {
        throw new EmbedderUnavailableError(
          "xenova",
          `@xenova/transformers is not installed: ${(err as Error).message}`
        );
      }
      const { pipeline } = mod;
      this.extractor = await pipeline("feature-extraction", this.modelName);
    })();
    return this.initPromise;
  }

  async embed(text: string): Promise<Float32Array> {
    await this.init();
    const out = await this.extractor(text, { pooling: "mean", normalize: true });
    return new Float32Array(out.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.init();
    const results: Float32Array[] = [];
    for (const text of texts) {
      const out = await this.extractor(text, { pooling: "mean", normalize: true });
      results.push(new Float32Array(out.data as Float32Array));
    }
    return results;
  }
}

/**
 * Try to instantiate a Xenova embedder; returns null if the package is not installed.
 */
export async function tryXenovaEmbedder(): Promise<XenovaEmbedder | null> {
  try {
    await import("@xenova/transformers");
    return new XenovaEmbedder();
  } catch {
    return null;
  }
}
