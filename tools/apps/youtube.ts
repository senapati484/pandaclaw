// tools/apps/youtube.ts
// YouTube helper to resolve channel links and latest videos using search scoping

import { webSearchTool } from "../web-search.js";
import type { ToolContext } from "../../modes/agent/types.js";

/**
 * Searches the web for a channel's name and resolves the latest video link.
 * Uses site-scoped searching (site:youtube.com) to find direct watch URLs.
 */
export async function resolveLatestVideo(
  channelName: string,
  context: ToolContext
): Promise<{ title: string; url: string }> {
  // A targeted query to find recent watch links for the specific channel
  const query = `site:youtube.com "${channelName}" latest video watch`;
  
  const results = (await webSearchTool.execute({ query }, context)) as Array<{
    title: string;
    url: string;
    snippet: string;
  }>;

  if (!results || results.length === 0) {
    throw new Error(`No search results found for YouTube channel: "${channelName}"`);
  }

  // 1. Look for a direct watch/video URL first (e.g. watch?v= or youtu.be/)
  const watchLink = results.find(
    (r) => r.url && (r.url.includes("youtube.com/watch") || r.url.includes("youtu.be/"))
  );

  if (watchLink) {
    return {
      title: watchLink.title,
      url: watchLink.url,
    };
  }

  // 2. Fallback: Find any youtube.com channel/user link
  const ytLink = results.find((r) => r.url && r.url.includes("youtube.com"));
  if (ytLink) {
    return {
      title: ytLink.title,
      url: ytLink.url,
    };
  }

  // 3. Ultimate fallback: Return the first available search result
  const firstResult = results[0];
  if (!firstResult) {
    throw new Error(`No search results found for YouTube channel: "${channelName}"`);
  }

  return {
    title: firstResult.title || "Resolved Video Link",
    url: firstResult.url,
  };
}
