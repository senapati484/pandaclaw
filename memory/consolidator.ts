import { writeFileSync, existsSync, readFileSync } from "fs";
import path from "path";
import { loadMemory, parseAndSaveGraphRelations } from "./store.js";
import type { PandaConfig } from "../ai/ai.config.js";
import { callLLM } from "../ai/llm.js";

export class MemoryConsolidator {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  public async consolidate(config: PandaConfig): Promise<string> {
    const memory = loadMemory();
    const entries = memory.recentEntries;

    if (entries.length === 0) {
      return "No entries to consolidate.";
    }

    // Compile entries list
    const logSummary = entries
      .map((e, idx) => `[${idx + 1}] Role: ${e.role}, Content: "${e.content}" (Importance: ${e.importance})`)
      .join("\n");

    const prompt = `You are a semantic memory consolidator agent for PandaClaw.
Analyze these raw conversation entries and extract core facts, user preferences, configurations, settings, success patterns, and constraints as a set of semantic triplets: Subject | Predicate | Object.

Examples:
- User | prefers styling | deep purple theme
- Workspace | uses framework | React with Bun
- PandaClaw | must avoid | overriding git user.name
- alarm_set tool | uses utility | macOS osascript

Raw Entries:
${logSummary}

Format the output strictly as a list of triplets, one per line, with no extra conversational text or markdown code blocks, formatted exactly as:
Subject | Predicate | Object`;

    try {
      const data = await callLLM(config, {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
        temperature: 0.2,
      });

      const graph = data.choices?.[0]?.message?.content ?? "";
      const extractedCount = parseAndSaveGraphRelations(graph);

      return `Consolidated ${extractedCount} semantic relations into PandaGraph.`;
    } catch (err: any) {
      return `Consolidation error: ${err.message}`;
    }
  }

  public getGraph(): string {
    const graphPath = path.join(this.workspacePath, ".pandaclaw", "KNOWLEDGE_GRAPH.md");
    if (existsSync(graphPath)) {
      return readFileSync(graphPath, "utf8");
    }
    return "";
  }
}

