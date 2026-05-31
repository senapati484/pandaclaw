import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { pruneAndCompactChats } from "../memory/store.js";
import { saveChatMessage, loadChatHistory } from "../memory/store.js";
import { existsSync, unlinkSync, writeFileSync, readFileSync } from "fs";

describe("Active Context Compaction", () => {
  const CHATS_PATH = ".pandaclaw/chats.jsonl";
  const COMPACTED_PATH = ".pandaclaw/COMPACTED_MEMORY.md";
  let originalChatsContent: string | null = null;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    if (existsSync(CHATS_PATH)) {
      originalChatsContent = readFileSync(CHATS_PATH, "utf8");
      unlinkSync(CHATS_PATH);
    }
    originalFetch = globalThis.fetch;
    // Mock fetch for LLM call
    globalThis.fetch = (async (url) => {
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: "User | prefers | TypeScript with Bun\nSystem | uses | macOS osascript for alarms"
            }
          }
        ]
      }), { status: 200 });
    }) as any;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    try {
      if (existsSync(COMPACTED_PATH)) unlinkSync(COMPACTED_PATH);
      if (existsSync(CHATS_PATH)) unlinkSync(CHATS_PATH);
      if (originalChatsContent !== null) {
        writeFileSync(CHATS_PATH, originalChatsContent, "utf8");
      }
    } catch {}
  });

  test("prunes oldest chat turns and saves compact markdown log", async () => {
    const chatId = "test_compact_chat";

    // Write 15 chat messages (exceeding keepLimit of 10)
    for (let i = 0; i < 15; i++) {
      saveChatMessage(chatId, i % 2 === 0 ? "user" : "assistant", `Message number ${i}`);
    }

    const historyBefore = loadChatHistory(chatId, 100);
    expect(historyBefore.length).toBe(15);

    const mockConfig = {
      providers: {
        groq: { api_key: "test", api_base: "https://api.groq.com/openai/v1" }
      },
      routing: {
        fast_path: { provider: "groq", model: "test-model", temperature: 0.1, maxTokens: 2048 },
        fallback_chain: ["groq"]
      }
    } as any;

    await pruneAndCompactChats(chatId, 10, mockConfig);

    const historyAfter = loadChatHistory(chatId, 100);
    expect(historyAfter.length).toBe(10);
    expect(historyAfter[0].content).toBe("Message number 5");
    expect(historyAfter[9].content).toBe("Message number 14");

    expect(existsSync(COMPACTED_PATH)).toBe(true);
    const content = readFileSync(COMPACTED_PATH, "utf8");
    expect(content).toContain("User | prefers | TypeScript with Bun");
  });
});
