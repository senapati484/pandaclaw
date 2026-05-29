// modes/ask/panda-mode.ts
// Slow, deliberate reasoning using DeepSeek R1 + Groq verification

import type { AskTask, AskResult } from "../../modes/agent/types.js";
import type { PandaConfig } from "../../ai/ai.config.js";

interface LLMResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { total_tokens: number };
}

export async function runPandaMode(
  task: AskTask,
  config: PandaConfig
): Promise<AskResult> {
  const start = Date.now();

  const groqKey = config.providers.groq.api_key;
  const orKey = config.providers.openrouter.api_key;

  // If no OpenRouter key, fall back to fast path
  if (!orKey) {
    const { runFastPath } = await import("./fast-path.js");
    return runFastPath(task, config);
  }

  const { model, maxTokens, temperature } = config.routing.panda_mode;
  const fastModel = config.routing.fast_path.model;

  // ── STEP 1: REASON — DeepSeek R1 ──
  const reasonMessages = [
    {
      role: "system",
      content: `You are PandaClaw, a thoughtful AI agent.
For complex requests: think step by step before answering.
Put your reasoning in <think>...</think> tags, then give your final answer.`,
    },
    // Last 4 messages for context
    ...task.conversationHistory.slice(-4),
    { role: "user", content: task.input },
  ];

  let rawResponse: string;
  let tokensUsed = 0;

  try {
    const reasonRes = await fetch(`${config.providers.openrouter.api_base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${orKey}`,
        "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
        "X-Title": "PandaClaw",
      },
      body: JSON.stringify({
        model,
        messages: reasonMessages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!reasonRes.ok) {
      throw new Error(`OpenRouter ${reasonRes.status}`);
    }

    const reasonData = (await reasonRes.json()) as LLMResponse;
    rawResponse = reasonData.choices[0]?.message?.content ?? "";
    tokensUsed = reasonData.usage?.total_tokens ?? 0;
  } catch {
    // Fallback to fast path if OpenRouter fails
    const { runFastPath } = await import("./fast-path.js");
    const result = await runFastPath(task, config);
    return { ...result, durationMs: Date.now() - start };
  }

  // Extract final answer (strip <think> tags)
  const finalAnswer = rawResponse.includes("</think>")
    ? rawResponse.split("</think>").slice(1).join("</think>").trim()
    : rawResponse.trim();

  // ── STEP 2: VERIFY — Groq fast second opinion ──
  let verified = false;
  let verifiedAnswer = finalAnswer;

  if (groqKey) {
    try {
      const verifyPrompt = `The user asked: "${task.input}"

An agent gave this answer:
${finalAnswer}

Is this answer complete and correct?
Reply EXACTLY with:
PASS   — if complete and correct
FIXED: <corrected answer>   — if something is missing or wrong`;

      const verifyRes = await fetch(`${config.providers.groq.api_base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: fastModel,
          messages: [{ role: "user", content: verifyPrompt }],
          max_tokens: 2048,
          temperature: 0,
        }),
      });

      const verifyData = (await verifyRes.json()) as LLMResponse;
      const verdict = verifyData.choices[0]?.message?.content ?? "";
      verified = verdict.startsWith("PASS");
      verifiedAnswer = verified ? finalAnswer : verdict.replace(/^FIXED:\s*/i, "").trim();
    } catch {
      // Verification failed — use original answer
    }
  }

  return {
    answer: verifiedAnswer,
    taskType: "complex",
    tokensUsed,
    provider: "openrouter",
    durationMs: Date.now() - start,
    verified,
  };
}
