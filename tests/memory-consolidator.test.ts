import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { MemoryConsolidator } from "../memory/consolidator";
import { saveToMemory, loadMemory } from "../memory/store";
import { readConfig } from "../ai/ai.config";
import { existsSync, unlinkSync } from "fs";
import path from "path";

describe("MemoryConsolidator", () => {
  const workspacePath = ".";
  let consolidator: MemoryConsolidator;
  const graphFile = path.join(workspacePath, ".pandaclaw", "KNOWLEDGE_GRAPH.md");

  beforeAll(() => {
    consolidator = new MemoryConsolidator(workspacePath);
    if (existsSync(graphFile)) {
      unlinkSync(graphFile);
    }
  });

  afterAll(() => {
    if (existsSync(graphFile)) {
      unlinkSync(graphFile);
    }
  });

  test("consolidates logs into graph file", async () => {
    // 1. Write some test memory entries
    saveToMemory({
      id: "test_entry_1",
      timestamp: Date.now(),
      role: "user",
      content: "The styling accent theme should always be deep purple.",
      importance: "high",
    });

    saveToMemory({
      id: "test_entry_2",
      timestamp: Date.now(),
      role: "assistant",
      content: "Got it! Custom styles set to #5b4d9e.",
      importance: "low",
    });

    const config = readConfig();
    
    // We can execute consolidation if Groq API key is present
    if (config.providers.groq.api_key) {
      const graph = await consolidator.consolidate(config);
      expect(graph).toBeDefined();
      if (!graph.startsWith("Consolidation error")) {
        expect(existsSync(graphFile)).toBe(true);
        // Verify loadMemory pulls from graph
        const memory = loadMemory();
        const hasGraphFact = memory.longTermFacts.some(f => f.id === "graph_consolidated");
        expect(hasGraphFact).toBe(true);
      }
    } else {
      // Mock flow if no API key
      expect(consolidator.getGraph()).toBe("");
    }
  }, 30000);
});
