// modes/ask/classifier.ts
// Routes user input to the right handler:
//   "action"  → runToolAgent (has file/exec/alarm tools) — anything that requires DOING something
//   "complex" → runPandaMode (deep reasoning, no tools) — analysis, comparisons, planning
//   "simple"  → runFastPath (fast Groq answer) — quick factual questions

import type { AskTaskType } from "../../modes/agent/types.js";

// Patterns that require TOOL execution (file access, code exec, alarms, system tasks)
const ACTION_PATTERNS = [
  // File operations (Create/Write/Save) — verb then noun OR noun then verb
  /\b(write|save|create|make|generate|put|store|export|add|append|insert)\b.*\b(file|code|script|program|text|note|doc|readme|manifest|package|json|yaml|xml|\.py|\.js|\.ts|\.md|\.txt|\.csv)\b/i,
  // File operations (Edit/Modify/Update) — CRITICAL: "edit", "modify", "update" etc.
  /\b(edit|modify|update|change|rewrite|refactor|fix|patch|replace|overwrite|revise|improve|alter|transform)\b.*\b(file|code|script|program|text|note|doc|readme|content|line|function|method|class|variable)\b/i,
  // File name with extension → always a file operation
  /\b\w+\.(py|js|ts|jsx|tsx|html|css|json|yaml|yml|xml|txt|md|sh|bash|go|rs|rb|java|cpp|c|h|php|swift|kt|r|csv|toml|ini|env|conf|config|log)\b/i,
  // File operations (Read/View)
  /\b(read|open|show me|display|print|get|fetch|cat|less|more|view|what is in|what's in|contents of)\b.*\b(file|folder|directory|desktop|document|src|test|config|package|tsconfig|env|log)\b/i,
  // File operations (Delete/Remove/Clean)
  /\b(delete|remove|erase|rm|del|discard|clear|cleanup|purge|unlink)\b.*\b(file|folder|directory|desktop|document|src|test|config|env|log|cache|temp)\b/i,
  // Path references → they mean a real file/folder operation
  /\b(desktop|downloads|documents|home|folder|directory|workspace|codebase|repo|repository)\b/i,
  // Code execution & terminal CLI tools
  /\b(run|execute|launch|start|install|pip|npm|bun|python|node|bash|sh|cmd|powershell|cli)\b/i,
  // System / alarm
  /\b(alarm|reminder|alert|remind|notify|notification|schedule|timer)\b/i,
  // Git operations
  /\b(push|commit|pull|clone|git|repo|github|pr|merge|checkout|status|branch)\b/i,
  // List / browse filesystem
  /\b(list|ls|dir|browse|tree|find|locate|where is)\b.*\b(file|folder|directory|desktop|workspace|codebase|repo)\b/i,
  // Search web & knowledge queries
  /\b(search|look up|find on|google|browse|web|internet|duckduckgo|tavily|wikipedia)\b/i,
  // Knowledge-seeking queries — route to tool agent for web_search
  /\b(what is|what's|who is|who's|what are|who are|tell me about|do you know|have you heard of|explain|define|describe)\b/i,
  /\b(what does|how does|how do|where is|when was|why is|why does|how can|what was|what are)\b.*\?/i,
  // Generic knowledge questions about topics, concepts, definitions
  /^(what|who|when|where|why|how)\s+(is|are|was|were|does|do|did|can|could|would|will)\s+/i,
  // Memory
  /\b(remember|recall|memory|what did i|do you know|last time|facts|preference)\b/i,
  // System settings, clipboard, and browser control V2/V3
  /\b(volume|audio|sound|mute|unmute|brightness|light|screen|monitor|display|clipboard|copy|paste)\b/i,
  // Browser apps and actions (websites, tabs, urls)
  /\b(open|launch|close|focus|scroll|navigate|refresh|reload|tab|tabs|browser|chrome|safari|firefox|edge|msedge|opera|youtube|url|link|website|site|google|github)\b/i,
  // Keyboard/Input controls
  /\b(type|press|keystroke|shortcut|hotkey|keys|key)\b/i,
  // Catch-all: any action word directly followed by a file path pattern
  /\/(Users|home|tmp|var|etc|opt|usr|Desktop|Downloads|Documents)\//i,
];

export type RouteType = "action" | "complex" | "simple";

/**
 * Classify the user's request into a routing category.
 * "action"  → tool agent (file ops, code exec, alarms, memory, search)
 * "complex" → panda mode (deep reasoning only)
 * "simple"  → fast path (quick factual answers)
 */
export function classifyRoute(input: string): RouteType {
  // Action patterns take priority — if ANY match, route to tool agent
  if (ACTION_PATTERNS.some((p) => p.test(input))) {
    return "action";
  }

  const lower = input.toLowerCase();

  // Complex reasoning signals — NOTE: debug/fix/refactor ARE actions if combined with file patterns above
  const complexSignals = [
    input.length > 300,
    input.split("\n").length > 3,
    /\b(explain how|why does|how does|what is the difference between)\b/.test(lower),
    /\b(compare|analyze|summarize|research|evaluate|plan|review|strategy)\b/.test(lower),
    /\b(step by step|walk me through|in detail|comprehensively)\b/.test(lower),
    lower.includes(" and ") && lower.includes(" then "),
  ];

  const complexScore = complexSignals.filter(Boolean).length;
  if (complexScore >= 2) return "complex";

  return "simple";
}


