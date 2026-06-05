// memory/store.ts

import path from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import type { MemoryEntry, PersistentMemory } from "../modes/agent/types.js";
import type { PandaConfig } from "../ai/ai.config.js";
import { callLLM } from "../ai/llm.js";

import * as os from "os";

const MAX_ENTRIES = 200;

import { getActiveWorkspace, getMemoryDir } from "../utils/paths.js";
export { getActiveWorkspace, getMemoryDir };

export function getMemoryPath(): string {
  return path.join(getMemoryDir(), "memory.jsonl");
}

export function getChatsPath(): string {
  return path.join(getMemoryDir(), "chats.jsonl");
}

export function getGraphPath(): string {
  return path.join(getMemoryDir(), "graph_memory.json");
}

export function getMarkdownPath(): string {
  return path.join(getMemoryDir(), "KNOWLEDGE_GRAPH.md");
}

export function getCompactedPath(): string {
  return path.join(getMemoryDir(), "COMPACTED_MEMORY.md");
}

export interface GraphRelation {
  subject: string;
  predicate: string;
  object: string;
  timestamp: number;
}

function ensureDir(): void {
  const dir = getMemoryDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── Persistent Chat Turn History ──────────────────────────────────────────

interface ChatMessage {
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
  writeFileSync(getChatsPath(), line, { flag: "a", encoding: "utf8" });
}

export function loadChatHistory(chatId: string, limit = 20): Array<{ role: "user" | "assistant"; content: string }> {
  ensureDir();
  if (!existsSync(getChatsPath())) return [];

  try {
    const text = readFileSync(getChatsPath(), "utf8");
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
  if (existsSync(getGraphPath())) {
    try {
      const data = JSON.parse(readFileSync(getGraphPath(), "utf8"));
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

  writeFileSync(getGraphPath(), JSON.stringify({ relations }), "utf8");
  syncGraphToMarkdown(relations);
}

export function parseAndSaveGraphRelations(text: string): number {
  const lines = text.split("\n").filter((l: string) => l.trim());
  let extractedCount = 0;
  for (const line of lines) {
    const cleanLine = line.replace(/^[\s•\-\d\.\*]+/, "").trim();
    const parts = cleanLine.split("|").map((p: string) => p.trim());
    if (parts.length === 3) {
      const [subject, predicate, object] = parts;
      if (subject && predicate && object) {
        saveGraphRelation({ subject, predicate, object });
        extractedCount++;
      }
    }
  }
  return extractedCount;
}


function syncGraphToMarkdown(relations: GraphRelation[]): void {
  const markdownPath = getMarkdownPath();
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
  if (!existsSync(getGraphPath())) return [];

  try {
    const data = JSON.parse(readFileSync(getGraphPath(), "utf8"));
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

  const graphPath = getMarkdownPath();
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

  if (!existsSync(getMemoryPath())) {
    return {
      sessionCount: 0,
      lastSeen: Date.now(),
      userPreferences: {},
      recentEntries: [],
      longTermFacts: graphFacts,
    };
  }

  const text = readFileSync(getMemoryPath(), "utf8");
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

  const existing = existsSync(getMemoryPath())
    ? readFileSync(getMemoryPath(), "utf8")
    : "";

  const lines = existing.split("\n").filter((l) => l.trim());

  if (lines.length >= MAX_ENTRIES) {
    const pruned = lines.slice(lines.length - MAX_ENTRIES + 1);
    writeFileSync(getMemoryPath(), pruned.join("\n") + "\n" + line, "utf8");
  } else {
    writeFileSync(getMemoryPath(), existing + line, "utf8");
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

export async function pruneAndCompactChats(chatId: string, keepLimit = 12, config: PandaConfig): Promise<void> {
  ensureDir();
  if (!existsSync(getChatsPath())) return;

  let allMessages: ChatMessage[] = [];
  try {
    const text = readFileSync(getChatsPath(), "utf8");
    const lines = text.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        allMessages.push(JSON.parse(line) as ChatMessage);
      } catch {}
    }
  } catch {
    return;
  }

  const chatMsgs = allMessages.filter(m => m.chatId === chatId);
  if (chatMsgs.length <= keepLimit) return;

  const toPrune = chatMsgs.slice(0, chatMsgs.length - keepLimit);
  const toKeep = chatMsgs.slice(chatMsgs.length - keepLimit);

  // Format pruned messages for compaction
  const prunedText = toPrune.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n");

  const prompt = `You are the memory compaction engine for PandaClaw.
Analyze these older conversation turns that are being pruned from active memory.
Extract any important facts, user preferences, project structures, success patterns, or rules.
Format the output as a list of semantic triplets (one per line):
Subject | Predicate | Object

Example:
User | prefers | TypeScript with Bun
System | uses | macOS osascript for alarms

Do not include any other conversational text or markdown formatting.`;

  try {
    const data = await callLLM(config, {
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: prunedText }
      ],
      max_tokens: 1024,
      temperature: 0.2
    });

    const response = data.choices?.[0]?.message?.content ?? "";
    parseAndSaveGraphRelations(response);

    // Also append a human-readable summary to COMPACTED_MEMORY.md
    const compactedPath = getCompactedPath();
    const timestamp = new Date().toLocaleString();
    const appendText = `\n### Compacted Memory (${timestamp})\n${response}\n`;
    writeFileSync(compactedPath, appendText, { flag: "a", encoding: "utf8" });

  } catch (err: any) {
    console.warn(`[compaction] Failed to compact memory: ${err.message}`);
  }

  // Filter allMessages to only keep the 'toKeep' messages for this chatId, and all messages for other chatIds
  const updatedMessages = allMessages.filter(m => {
    if (m.chatId !== chatId) return true;
    return toKeep.some(k => k.timestamp === m.timestamp && k.content === m.content && k.role === m.role);
  });

  // Write back to chats.jsonl
  const newText = updatedMessages.map(m => JSON.stringify(m)).join("\n") + "\n";
  writeFileSync(getChatsPath(), newText, "utf8");
}

