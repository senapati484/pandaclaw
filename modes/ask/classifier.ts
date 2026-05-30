// modes/ask/classifier.ts
// Routes user input to the right handler:
//   "action"  → runToolAgent (has file/exec/alarm tools) — anything that requires DOING something
//   "complex" → runPandaMode (deep reasoning, no tools) — analysis, comparisons, planning
//   "simple"  → runFastPath (fast Groq answer) — quick factual questions

import type { AskTaskType } from "../../modes/agent/types.js";

// Patterns that require TOOL execution (file access, code exec, alarms, system tasks)
const ACTION_PATTERNS = [
  // File operations
  /\b(write|save|create|make|generate|put|store|export)\b.*\b(file|code|script|program|text|note|doc)\b/i,
  /\b(read|open|show me|display|print|get|fetch)\b.*\b(file|folder|directory|desktop|document)\b/i,
  // Path references → they mean a real file operation
  /\b(desktop|downloads|documents|home|folder|directory)\b/i,
  // Code execution
  /\b(run|execute|launch|start|install|pip|npm|bun|python|node)\b/i,
  // System / alarm
  /\b(alarm|reminder|alert|remind|notify|notification|schedule|timer)\b/i,
  // Git operations
  /\b(push|commit|pull|clone|git)\b/i,
  // List / browse filesystem
  /\b(list|ls|dir)\b.*\b(file|folder|directory|desktop)\b/i,
  // Search web
  /\b(search|look up|find on|google|browse)\b/i,
  // Memory
  /\b(remember|recall|memory|what did i|do you know|last time)\b/i,
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

  // Complex reasoning signals
  const complexSignals = [
    input.length > 300,
    input.split("\n").length > 3,
    /\b(explain how|why does|how does|what is the difference between)\b/.test(lower),
    /\b(compare|analyze|summarize|research|evaluate|plan|review|strategy)\b/.test(lower),
    /\b(step by step|walk me through|in detail|comprehensively)\b/.test(lower),
    /\b(debug|fix|refactor|optimize|test|deploy)\b/.test(lower),
    lower.includes(" and ") && lower.includes(" then "),
  ];

  const complexScore = complexSignals.filter(Boolean).length;
  if (complexScore >= 2) return "complex";

  return "simple";
}

// ── Legacy: keep classifyTask for backward compatibility ───────────────────
export type AskTaskTypeCompat = AskTaskType;

export function classifyTask(input: string): AskTaskType {
  const route = classifyRoute(input);
  // Map: action → complex (so it goes to tool agent in legacy gateways)
  // but gateway/index.ts now uses classifyRoute directly
  return route === "simple" ? "simple" : "complex";
}
