// tools/web-fetch.ts
// Fetches a URL and returns cleaned text content

import type { ToolDefinition } from "../modes/agent/types.js";

export const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  description: "Fetch and extract text content from a URL",
  risky: false,
  readOnly: true,
  execute: async (args, _ctx) => {
    const url = args.url as string;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (PandaClaw/1.0)",
        Accept: "text/html,text/plain,application/json",
      },
      // 10 second timeout
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }

    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const json = await res.json();
      return JSON.stringify(json, null, 2);
    }

    const html = await res.text();

    // Strip HTML tags for cleaner text
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{3,}/g, "\n")
      .trim()
      .slice(0, 8000); // Limit to 8K chars

    return text;
  },
};
