import { readdirSync, statSync, existsSync } from "fs";
import { resolve, relative, extname, basename, sep } from "path";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".pandaclaw", "dist", "out", "coverage", ".cache",
  ".DS_Store", ".idea", ".vscode", "build", ".bun",
]);

const MAX_DEPTH = 8;

interface FileEntry {
  path: string;
  name: string;
  dir: string;
  ext: string;
  score: number;
}

export class FileMentionResolver {
  private workspaceRoot: string;
  private fileCache: FileEntry[] = [];
  private lastScan = 0;
  private scanIntervalMs = 30_000;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  private scanFiles(dir: string, depth = 0): FileEntry[] {
    if (depth > MAX_DEPTH) return [];
    if (!existsSync(dir)) return [];

    const entries: FileEntry[] = [];

    try {
      const items = readdirSync(dir);
      for (const item of items) {
        if (item.startsWith(".") && item !== ".") continue;
        if (IGNORE_DIRS.has(item)) continue;

        const fullPath = resolve(dir, item);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            entries.push(...this.scanFiles(fullPath, depth + 1));
          } else if (stat.isFile()) {
            const rel = relative(this.workspaceRoot, fullPath);
            entries.push({
              path: rel,
              name: item,
              dir: relative(this.workspaceRoot, dir),
              ext: extname(item).toLowerCase(),
              score: 0,
            });
          }
        } catch {}
      }
    } catch {}

    return entries;
  }

  refresh(): void {
    this.fileCache = this.scanFiles(this.workspaceRoot);
    this.lastScan = Date.now();
  }

  private ensureFresh(): void {
    if (Date.now() - this.lastScan > this.scanIntervalMs || this.fileCache.length === 0) {
      this.refresh();
    }
  }

  private calculateRelevanceScore(filename: string, query: string): number {
    const q = query.toLowerCase();
    const f = filename.toLowerCase();
    const fname = basename(filename).toLowerCase();

    let score = 0;

    if (f === q) score += 100;
    else if (fname === q) score += 80;
    else if (f === `${q}.ts` || f === `${q}.tsx` || f === `${q}.js`) score += 75;
    else if (fname === `${q}.ts` || fname === `${q}.tsx` || fname === `${q}.js`) score += 60;
    else if (f.includes(q)) score += 40;
    else if (fname.includes(q)) score += 30;

    const queryParts = q.split(/[\/\\_.-]/);
    const fileParts = f.split(/[\/\\_.-]/);
    let matchCount = 0;
    for (const qp of queryParts) {
      if (qp.length < 2) continue;
      for (const fp of fileParts) {
        if (fp.startsWith(qp)) matchCount++;
      }
    }
    score += matchCount * 5;

    if (q.includes("/") || q.includes("\\")) {
      const qNormalized = q.replace(/\\/g, "/");
      const fNormalized = f.replace(/\\/g, "/");
      if (fNormalized.startsWith(qNormalized)) score += 50;
      if (fNormalized.includes(qNormalized)) score += 25;
    }

    return score;
  }

  resolve(input: string): FileEntry[] {
    this.ensureFresh();

    if (!input.startsWith("@")) return [];

    const query = input.slice(1).trim();
    if (!query) return [];

    const scored = this.fileCache
      .map((f) => ({
        ...f,
        score: this.calculateRelevanceScore(f.path, query),
      }))
      .filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 10);
  }

  resolveBestMatch(query: string): string | null {
    const results = this.resolve(`@${query}`);
    return results.length > 0 ? results[0]!.path : null;
  }

  getProjectFiles(ext?: string): string[] {
    this.ensureFresh();
    if (ext) {
      return this.fileCache.filter((f) => f.ext === ext.toLowerCase()).map((f) => f.path);
    }
    return this.fileCache.map((f) => f.path);
  }

  getImportableFiles(): { path: string; exports: string }[] {
    this.ensureFresh();
    return this.fileCache
      .filter((f) => [".ts", ".tsx", ".js", ".jsx"].includes(f.ext))
      .map((f) => ({ path: f.path, exports: f.name.replace(f.ext, "") }));
  }
}

export function extractFileMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = /@([\w\/\\_.-]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]!);
  }
  return mentions;
}
