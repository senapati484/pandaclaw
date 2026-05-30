// memory/store.ts

import path from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import type { MemoryEntry, PersistentMemory } from "../modes/agent/types.js";

const MEMORY_PATH = ".pandaclaw/memory.jsonl";
const CHATS_PATH = ".pandaclaw/chats.jsonl";
const GRAPH_PATH = ".pandaclaw/graph_memory.json";
const MAX_ENTRIES = 200;

export interface GraphRelation {
  subject: string;
  predicate: string;
  object: string;
  timestamp: number;
}

function ensureDir(): void {
  const dir = path.dirname(MEMORY_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── Persistent Chat Turn History ──────────────────────────────────────────

export interface ChatMessage {
  chatId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export function saveChatMessage(chatId: string, role: "user" | "assistant", content: string): void {
  ensureDir();
  const entry: ChatMessage = {
    chatId,
    role,
    content,
    timestamp: Date.now(),
  };
  const line = JSON.stringify(entry) + "\n";
  writeFileSync(CHATS_PATH, line, { flag: "a", encoding: "utf8" });
}

export function loadChatHistory(chatId: string, limit = 20): Array<{ role: "user" | "assistant"; content: string }> {
  ensureDir();
  if (!existsSync(CHATS_PATH)) return [];

  try {
    const text = readFileSync(CHATS_PATH, "utf8");
    const lines = text.split("\n").filter((l) => l.trim());
    const history: ChatMessage[] = [];

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as ChatMessage;
        if (msg.chatId === chatId) {
          history.push(msg);
        }
      } catch {}
    }

    return history.slice(-limit).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  } catch {
    return [];
  }
}

// ── Semantic Knowledge Graph Nodes/Edges Store ────────────────────────────

export function saveGraphRelation(relation: Omit<GraphRelation, "timestamp">): void {
  ensureDir();
  let relations: GraphRelation[] = [];
  if (existsSync(GRAPH_PATH)) {
    try {
      const data = JSON.parse(readFileSync(GRAPH_PATH, "utf8"));
      if (Array.isArray(data.relations)) {
        relations = data.relations;
      }
    } catch {}
  }

  // Deduplicate by comparing lowercase subject, predicate, and object
  relations = relations.filter(
    (r) =>
      !(
        r.subject.toLowerCase() === relation.subject.toLowerCase() &&
        r.predicate.toLowerCase() === relation.predicate.toLowerCase() &&
        r.object.toLowerCase() === relation.object.toLowerCase()
      )
  );

  relations.push({
    ...relation,
    timestamp: Date.now(),
  });

  writeFileSync(GRAPH_PATH, JSON.stringify({ relations }), "utf8");
  syncGraphToMarkdown(relations);
}

export function syncGraphToMarkdown(relations: GraphRelation[]): void {
  const markdownPath = ".pandaclaw/KNOWLEDGE_GRAPH.md";
  if (relations.length === 0) {
    writeFileSync(markdownPath, "# 🐼 PandaClaw Knowledge Graph\n\nNo semantic relations recorded yet.", "utf8");
    return;
  }

  // Group relations by subject for structured categorization
  const groups: Record<string, string[]> = {};
  for (const r of relations) {
    const list = groups[r.subject] || [];
    list.push(`- **${r.predicate}**: ${r.object}`);
    groups[r.subject] = list;
  }

  let markdown = "# 🐼 PandaClaw Knowledge Graph\n\n";
  markdown += "A persistent semantic graph representing entities, preferences, constraints, and success patterns.\n\n";

  for (const [subject, facts] of Object.entries(groups)) {
    markdown += `## ${subject}\n`;
    markdown += facts.join("\n") + "\n\n";
  }

  writeFileSync(markdownPath, markdown, "utf8");
}

export function recallRelevantRelations(query: string, limit = 5): string[] {
  if (!existsSync(GRAPH_PATH)) return [];

  try {
    const data = JSON.parse(readFileSync(GRAPH_PATH, "utf8"));
    const relations: GraphRelation[] = data.relations || [];
    if (relations.length === 0) return [];

    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.trim());
    if (queryWords.length === 0) return [];

    // Calculate document-frequency style weight mapping for the relations graph
    const wordCounts: Record<string, number> = {};
    for (const r of relations) {
      const text = `${r.subject} ${r.predicate} ${r.object}`.toLowerCase();
      const uniqueWords = new Set(text.split(/\s+/).filter(Boolean));
      for (const w of uniqueWords) {
        wordCounts[w] = (wordCounts[w] || 0) + 1;
      }
    }

    const scored = relations.map((r) => {
      const text = `${r.subject} ${r.predicate} ${r.object}`.toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        if (text.includes(word)) {
          const occurrences = text.split(word).length - 1;
          const docFreq = wordCounts[word] || 1;
          const idf = Math.log(relations.length / docFreq) + 1;
          score += occurrences * idf;
        }
      }
      return { relation: r, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => `• ${s.relation.subject} ${s.relation.predicate}: ${s.relation.object}`);
  } catch {
    return [];
  }
}

// ── Legacy Compatibility Layer ────────────────────────────────────────────

export function loadMemory(): PersistentMemory {
  ensureDir();

  const graphPath = path.join(path.dirname(MEMORY_PATH), "KNOWLEDGE_GRAPH.md");
  const graphFacts: MemoryEntry[] = [];
  if (existsSync(graphPath)) {
    try {
      const graphText = readFileSync(graphPath, "utf8");
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
    } catch {}
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

