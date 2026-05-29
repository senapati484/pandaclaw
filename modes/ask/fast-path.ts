// modes/ask/fast-path.ts
// Direct Groq call for simple questions — optimized for low latency

import type { AskTask, AskResult } from "../../modes/agent/types.js";
import type { PandaConfig } from "../../ai/ai.config.js";

interface GroqResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { total_tokens: number };
}

export async function runFastPath(
  task: AskTask,
  config: PandaConfig
): Promise<AskResult> {
  const start = Date.now();

  const apiKey = config.providers.groq.api_key;
  const apiBase = config.providers.groq.api_base;
  const { model, maxTokens, temperature } = config.routing.fast_path;

  if (!apiKey) {
    // Offline fallback — echo question back with a note
    return {
      answer: `[Offline mode] No Groq API key configured. Your question was: "${task.input}"`,
      taskType: "simple",
      tokensUsed: 0,
      provider: "groq",
      durationMs: Date.now() - start,
      verified: false,
    };
  }

  const messages = [
    {
      role: "system",
      content: "You are PandaClaw, a helpful and concise AI assistant. Answer accurately and briefly.",
    },
    // Include last 6 messages (3 exchanges) for context
    ...task.conversationHistory.slice(-6),
    { role: "user", content: task.input },
  ];

  const res = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as GroqResponse;

  return {
    answer: data.choices[0]?.message?.content ?? "(no response)",
    taskType: "simple",
    tokensUsed: data.usage?.total_tokens ?? 0,
    provider: "groq",
    durationMs: Date.now() - start,
    verified: false,
  };
}
