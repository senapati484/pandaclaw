import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

interface CacheEntry {
  key: string;
  prompt: string;
  response: string;
  model: string;
  timestamp: number;
  accessCount: number;
}

const CACHE_PATH = ".pandaclaw/response-cache.json";
const MAX_ENTRIES = 500;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && w.length < 50);
}

function computeTF(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  const maxFreq = Math.max(...freq.values(), 1);
  for (const [token, count] of freq) {
    freq.set(token, count / maxFreq);
  }
  return freq;
}

function cosineSimilarity(tf1: Map<string, number>, tf2: Map<string, number>): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (const [token, weight] of tf1) {
    norm1 += weight * weight;
    const w2 = tf2.get(token) ?? 0;
    dotProduct += weight * w2;
  }

  for (const [, weight] of tf2) {
    norm2 += weight * weight;
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

class ResponseCache {
  private entries: CacheEntry[] = [];
  private filePath: string;
  private similarityThreshold: number;

  constructor(similarityThreshold = 0.92) {
    this.filePath = resolve(process.cwd(), CACHE_PATH);
    this.similarityThreshold = similarityThreshold;
    this.load();
  }

  private load(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, "utf8"));
        this.entries = Array.isArray(data) ? data : [];
        this.evictOld();
      }
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.entries), "utf8");
    } catch {}
  }

  private evictOld(): void {
    const now = Date.now();
    this.entries = this.entries.filter((e) => now - e.timestamp < MAX_AGE_MS);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.sort((a, b) => b.accessCount - a.accessCount);
      this.entries = this.entries.slice(0, MAX_ENTRIES);
    }
  }

  lookup(prompt: string, model: string): { hit: boolean; response: string; similarity: number } | null {
    const promptTF = computeTF(prompt);
    let bestMatch: { entry: CacheEntry; similarity: number } | null = null;

    for (const entry of this.entries) {
      if (entry.model !== model) continue;
      const entryTF = computeTF(entry.prompt);
      const similarity = cosineSimilarity(promptTF, entryTF);

      if (similarity >= this.similarityThreshold) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { entry, similarity };
        }
      }
    }

    if (bestMatch) {
      bestMatch.entry.accessCount++;
      bestMatch.entry.timestamp = Date.now();
      this.save();
      return {
        hit: true,
        response: bestMatch.entry.response,
        similarity: bestMatch.similarity,
      };
    }

    return null;
  }

  store(prompt: string, response: string, model: string): void {
    const key = `${model}:${prompt.slice(0, 100)}`;
    this.entries.push({
      key,
      prompt,
      response,
      model,
      timestamp: Date.now(),
      accessCount: 1,
    });

    if (this.entries.length > MAX_ENTRIES) {
      this.evictOld();
    }
    this.save();
  }

  clear(): void {
    this.entries = [];
    this.save();
  }

  stats(): { size: number; maxEntries: number } {
    return { size: this.entries.length, maxEntries: MAX_ENTRIES };
  }
}

let _globalCache: ResponseCache | null = null;

export function getCache(): ResponseCache {
  if (!_globalCache) {
    _globalCache = new ResponseCache();
  }
  return _globalCache;
}


