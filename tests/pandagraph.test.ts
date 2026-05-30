import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import {
  saveChatMessage,
  loadChatHistory,
  saveGraphRelation,
  recallRelevantRelations
} from "../memory/store";
import { existsSync, unlinkSync } from "fs";

describe("PandaGraph Memory Engine", () => {
  const chatsPath = ".pandaclaw/chats.jsonl";
  const graphPath = ".pandaclaw/graph_memory.json";
  const markdownPath = ".pandaclaw/KNOWLEDGE_GRAPH.md";

  beforeAll(() => {
    // Clean up any existing test files
    if (existsSync(chatsPath)) unlinkSync(chatsPath);
    if (existsSync(graphPath)) unlinkSync(graphPath);
    if (existsSync(markdownPath)) unlinkSync(markdownPath);
  });

  afterAll(() => {
    // Clean up after tests run
    if (existsSync(chatsPath)) unlinkSync(chatsPath);
    if (existsSync(graphPath)) unlinkSync(graphPath);
    if (existsSync(markdownPath)) unlinkSync(markdownPath);
  });

  test("persists and filters chat history by chatId", () => {
    const chat1 = "test_chat_user_1";
    const chat2 = "test_chat_user_2";

    saveChatMessage(chat1, "user", "Hello from Chat 1");
    saveChatMessage(chat1, "assistant", "Response to Chat 1");
    saveChatMessage(chat2, "user", "Hello from Chat 2");

    expect(existsSync(chatsPath)).toBe(true);

    const history1 = loadChatHistory(chat1);
    expect(history1.length).toBe(2);
    expect(history1[0]).toEqual({ role: "user", content: "Hello from Chat 1" });
    expect(history1[1]).toEqual({ role: "assistant", content: "Response to Chat 1" });

    const history2 = loadChatHistory(chat2);
    expect(history2.length).toBe(1);
    expect(history2[0]).toEqual({ role: "user", content: "Hello from Chat 2" });
  });

  test("persists semantic graph relations and syncs KNOWLEDGE_GRAPH.md", () => {
    saveGraphRelation({
      subject: "User",
      predicate: "prefers styling",
      object: "deep purple theme"
    });

    saveGraphRelation({
      subject: "PandaClaw",
      predicate: "runs on",
      object: "macOS and Linux devices"
    });

    expect(existsSync(graphPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);

    const mdContent = require("fs").readFileSync(markdownPath, "utf8");
    expect(mdContent).toContain("## User");
    expect(mdContent).toContain("- **prefers styling**: deep purple theme");
    expect(mdContent).toContain("## PandaClaw");
    expect(mdContent).toContain("- **runs on**: macOS and Linux devices");
  });

  test("recalls relevant graph facts using TF-IDF term frequencies", () => {
    // Clear graph and save fresh relations
    if (existsSync(graphPath)) unlinkSync(graphPath);

    saveGraphRelation({
      subject: "Alice",
      predicate: "loves using",
      object: "FastAPI with Postgres"
    });

    saveGraphRelation({
      subject: "Bob",
      predicate: "prefers coding in",
      object: "TypeScript with Bun"
    });

    saveGraphRelation({
      subject: "PandaClaw",
      predicate: "avoids overriding",
      object: "git author credentials"
    });

    // Query Bob's preferences
    const bobRecall = recallRelevantRelations("Bob preferences");
    expect(bobRecall.length).toBe(1);
    expect(bobRecall[0]).toContain("Bob prefers coding in: TypeScript with Bun");

    // Query git configuration
    const gitRecall = recallRelevantRelations("git configuration rules");
    expect(gitRecall.length).toBe(1);
    expect(gitRecall[0]).toContain("PandaClaw avoids overriding: git author credentials");

    // Query non-existent terms
    const emptyRecall = recallRelevantRelations("nonexistent query terms");
    expect(emptyRecall.length).toBe(0);
  });
});
