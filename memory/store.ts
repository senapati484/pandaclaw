// memory/store.ts

import path from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import type { MemoryEntry, PersistentMemory } from "../modes/agent/types.js";

const MEMORY_PATH = ".pandaclaw/memory.jsonl";
const MAX_ENTRIES = 200;

function ensureDir(): void {
  const dir = path.dirname(MEMORY_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function loadMemory(): PersistentMemory {
  ensureDir();

  const graphPath = path.join(path.dirname(MEMORY_PATH), "KNOWLEDGE_GRAPH.md");
  const graphFacts: MemoryEntry[] = [];
  if (existsSync(graphPath)) {
    try {
      const graphText = readFileSync(graphPath, "utf8");
      // Add graph text segments as long term facts
      graphFacts.push({
        id: "graph_consolidated",
        timestamp: Date.now(),
        role: "assistant",
        content: graphText,
        importance: "high",
      });
    } catch {}
  }

  if (!existsSync(MEMORY_PATH)) {
    return {
      sessionCount: 0,
      lastSeen: Date.now(),
      userPreferences: {},
      recentEntries: [],
      longTermFacts: graphFacts,
    };
  }

  const text = readFileSync(MEMORY_PATH, "utf8");
  const lines = text.split("\n").filter((l) => l.trim());

  let entries: MemoryEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as MemoryEntry);
    } catch {
      // Skip corrupt lines
    }
  }

  return {
    sessionCount: 0,
    lastSeen: Date.now(),
    userPreferences: {},
    recentEntries: entries.slice(-50),
    longTermFacts: [
      ...graphFacts,
      ...entries.filter((e) => e.importance === "high"),
    ],
  };
}

export function saveToMemory(entry: MemoryEntry): void {
  ensureDir();

  const line = JSON.stringify(entry) + "\n";

  const existing = existsSync(MEMORY_PATH)
    ? readFileSync(MEMORY_PATH, "utf8")
    : "";

  const lines = existing.split("\n").filter((l) => l.trim());

  // Prune if too many entries
  if (lines.length >= MAX_ENTRIES) {
    const pruned = lines.slice(lines.length - MAX_ENTRIES + 1);
    writeFileSync(MEMORY_PATH, pruned.join("\n") + "\n" + line, "utf8");
  } else {
    writeFileSync(MEMORY_PATH, existing + line, "utf8");
  }
}

export function recallRelevant(
  query: string,
  entries: MemoryEntry[],
  topK = 5
): MemoryEntry[] {
  const words = query.toLowerCase().split(/\s+/);

  return entries
    .map((entry) => ({
      entry,
      score:
        words.filter((w) => entry.content.toLowerCase().includes(w)).length * 2 +
        (entry.importance === "high" ? 3 : entry.importance === "medium" ? 1 : 0) +
        (Date.now() - entry.timestamp < 86_400_000 ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.entry);
}
