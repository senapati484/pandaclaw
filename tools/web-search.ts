// tools/web-search.ts
// Searches the web using Tavily API or DuckDuckGo organic scrape as fallback

import type { ToolDefinition } from "../modes/agent/types.js";
import * as cheerio from "cheerio";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchTavily(query: string, apiKey: string, maxResults: number): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
  });

  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = (await res.json()) as TavilyResponse;

  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

async function searchDuckDuckGoScrape(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) throw new Error(`DuckDuckGo Scrape ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const results: SearchResult[] = [];
    $(".result").each((_, elem) => {
      if (results.length >= maxResults) return;

      const title = $(elem).find(".result__snippet").prev().text().trim();
      let link = $(elem).find(".result__url").attr("href");
      const snippet = $(elem).find(".result__snippet").text().trim();

      if (title && link) {
        if (link.startsWith("//")) {
          link = "https:" + link;
        }
        try {
          const urlObj = new URL(link);
          const uddg = urlObj.searchParams.get("uddg");
          if (uddg) {
            link = decodeURIComponent(uddg);
          }
        } catch {}

        results.push({ title, url: link, snippet });
      }
    });

    return results;
  } catch (err) {
    return [];
  }
}

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description: "Search the web for current information about a topic",
  risky: false,
  readOnly: true,
  execute: async (args, _ctx) => {
    const query = args.query as string;
    const { readConfig } = await import("../ai/ai.config.js");
    const config = readConfig();

    const apiKey = config.tools?.web_search?.api_key;
    const maxResults = config.tools?.web_search?.maxResults ?? 5;

    if (apiKey) {
      try {
        return await searchTavily(query, apiKey, maxResults);
      } catch {
        // Fall through to DuckDuckGo Scrape
      }
    }

    return await searchDuckDuckGoScrape(query, maxResults);
  },
};
