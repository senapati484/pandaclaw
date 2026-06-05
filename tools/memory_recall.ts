// tools/memory_recall.ts
// Semantic search across past sessions, code files, and indexed memories.
// Backed by the RAG store (TFIDF by default; Xenova when available).

import type { ToolDefinition } from "../modes/agent/types.js";
import { getRAGStore } from "../memory/rag.js";

export const memoryRecallTool: ToolDefinition = {
  name: "memory_recall",
  description:
    "Search long-term memory (past sessions, indexed code, notes) using semantic similarity. " +
    "Returns the top-k matching snippets with relevance scores.",
  riskLevel: "safe",
  readOnly: true,
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
      k: { type: "number", description: "Number of results to return (default 5)" },
      minScore: {
        type: "number",
        description: "Minimum similarity score 0-1 to include (default 0)",
      },
    },
    required: ["query"],
  },
  execute: async (args) => {
    const query = args.query as string;
    const k = (args.k as number) ?? 5;
    const minScore = (args.minScore as number) ?? 0;
    if (!query || typeof query !== "string") {
      throw new Error("memory_recall: 'query' is required");
    }
    const store = await getRAGStore();
    const results = await store.search(query, k, minScore);
    if (results.length === 0) {
      return { hits: [], message: "No matching memories found." };
    }
    return {
      hits: results.map((r) => ({
        text: r.text,
        score: Number(r.score.toFixed(4)),
        metadata: r.metadata,
        createdAt: r.createdAt,
      })),
    };
  },
};
