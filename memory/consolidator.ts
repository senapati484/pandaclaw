import { writeFileSync, existsSync, readFileSync } from "fs";
import path from "path";
import { loadMemory } from "./store.js";
import type { PandaConfig } from "../ai/ai.config.js";

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

    const apiKey = config.providers.groq.api_key;
    if (!apiKey) {
      return "Groq key missing, cannot consolidate memory.";
    }

    // Compile entries list
    const logSummary = entries
      .map((e, idx) => `[${idx + 1}] Role: ${e.role}, Content: "${e.content}" (Importance: ${e.importance})`)
      .join("\n");

    const prompt = `You are a memory consolidator agent for PandaClaw.
Analyze these raw conversation entries and build a consolidated Knowledge Graph of:
1. User preferences (custom configurations, layout settings).
2. Known entities (frameworks, tech stacks, file names).
3. Learned constraints (unsupported APIs, path guards, bugs to avoid).
4. Success patterns (how specific problems were solved).

Raw Entries:
${logSummary}

Format the output strictly as a clean Markdown document with ## headers for each category. Keep it concise.`;

    try {
      const res = await fetch(`${config.providers.groq.api_base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.routing.fast_path.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2048,
          temperature: 0.2,
        }),
      });

      if (!res.ok) throw new Error("API call failed");

      const data = (await res.json()) as any;
      const graph = data.choices[0]?.message?.content ?? "";

      const graphPath = path.join(this.workspacePath, ".pandaclaw", "KNOWLEDGE_GRAPH.md");
      writeFileSync(graphPath, graph, "utf8");

      return graph;
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
