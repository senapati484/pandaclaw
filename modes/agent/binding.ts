// modes/agent/binding.ts
// Helpers for parsing and matching channel bindings.

import type { ChannelBinding } from "./agent-types.js";

/**
 * Parse a binding string like "telegram:*" or "telegram:-1001234567".
 * Returns null if the string is malformed.
 */
export function parseBinding(raw: string): ChannelBinding | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (trimmed === "*") {
    return { raw: trimmed, platform: "*", pattern: "*" };
  }

  const colon = trimmed.indexOf(":");
  if (colon < 0) {
    // bare platform name => match all chats on that platform
    return { raw: trimmed, platform: trimmed, pattern: "*" };
  }

  const platform = trimmed.slice(0, colon);
  const pattern = trimmed.slice(colon + 1);
  if (!platform || !pattern) return null;
  return { raw: trimmed, platform, pattern };
}

/**
 * Match an inbound message's (platform, chatId) against a binding.
 * Returns the specific match reason or null.
 *
 * Precedence (per binding, most specific first):
 *   - exact:    pattern === chatId
 *   - prefix:   pattern ends with "*" and chatId startsWith(stripped)
 *   - platform: pattern === "*" (any chat on this platform)
 *   - wildcard: platform === "*" (any channel at all)
 */
export function matchBinding(
  binding: ChannelBinding,
  platform: string,
  chatId: string
): "exact" | "prefix" | "platform" | "wildcard" | null {
  if (binding.platform === "*") return "wildcard";
  if (binding.platform !== platform) return null;

  if (binding.pattern === "*") return "platform";
  if (binding.pattern === chatId) return "exact";
  if (binding.pattern.endsWith("*")) {
    const stem = binding.pattern.slice(0, -1);
    if (chatId.startsWith(stem)) return "prefix";
  }
  return null;
}
