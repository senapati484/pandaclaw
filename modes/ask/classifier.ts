// modes/ask/classifier.ts
// Classifies user input as simple (fast Groq) or complex (panda mode)

import type { AskTaskType } from "../../modes/agent/types.js";

interface ClassificationSignal {
  match: boolean;
}

export function classifyTask(input: string): AskTaskType {
  const lower = input.toLowerCase();

  const signals: ClassificationSignal[] = [
    // Long inputs are probably complex
    { match: input.length > 250 },
    // Multi-line inputs
    { match: input.split("\n").length > 2 },
    // Action verbs that require building/creating
    { match: /\b(write|build|create|implement|design|architect|generate)\b/.test(lower) },
    // Explanation requests
    { match: /\b(explain how|why does|how does|what is the difference)\b/.test(lower) },
    // Research or analysis tasks
    { match: /\b(compare|analyze|summarize|research|evaluate|plan|review)\b/.test(lower) },
    // Instructional phrasing
    { match: /\b(step by step|walk me through|in detail|comprehensively)\b/.test(lower) },
    // Compound goal
    { match: lower.includes(" and ") && lower.includes(" then ") },
    // Code operations
    { match: /\b(debug|fix|refactor|optimize|test|deploy)\b/.test(lower) },
  ];

  const score = signals.filter((s) => s.match).length;

  // 2+ signals → complex; otherwise simple
  return score >= 2 ? "complex" : "simple";
}
