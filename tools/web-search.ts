// tools/web-search.ts
// Searches the web using Tavily API or DuckDuckGo instant answers as fallback

import type { ToolDefinition } from "../modes/agent/types.js";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

interface DDGResponse {
  Heading: string;
  AbstractText: string;
  AbstractURL: string;
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

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "PandaClaw/1.0" },
  });
  const data = (await res.json()) as DDGResponse;

  const results: SearchResult[] = [];
  if (data.AbstractText) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL || "",
      snippet: data.AbstractText,
    });
  }
  return results;
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
        // Fall through to DuckDuckGo
      }
    }

    return await searchDuckDuckGo(query);
  },
};
