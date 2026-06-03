// modes/ask/panda-mode.ts
// Slow, deliberate reasoning using DeepSeek R1 + Groq verification

import type { AskTask, AskResult } from "../../modes/agent/types.js";
import type { PandaConfig } from "../../ai/ai.config.js";
import { sanitizeMessages, fetchWithRetry } from "../../ai/providers/llm-utils.js";

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

  // Panda mode fallback chain: DeepSeek R1 → Qwen3 → fast-path
  const pandaModels = [
    model,                                           // deepseek/deepseek-r1:free (primary)
    "meta-llama/llama-3.3-70b-instruct:free",        // Llama 3.3 70B — verified free on OpenRouter
    "openai/gpt-oss-120b:free",                      // GPT-OSS 120B — strong fallback
  ];

  // ── STEP 1: REASON — try each model in turn ──

  // Detect if the request is code-related so we can inject quality heuristics
  const codeKeywords = /\b(write|create|generate|make|build|implement|code|script|program|function|class|module|fix|refactor|debug|edit)\b/i;
  const isCodeRequest = codeKeywords.test(task.input);

  const codeQualityAddendum = isCodeRequest
    ? `

CODE QUALITY REQUIREMENTS (mandatory for this request):
- All paths must be dynamic (os.path.expanduser, $HOME, os.homedir()) — NEVER hardcode /home/user or C:\\Users\\...
- Wrap all IO and network calls in try/except (Python) or try/catch (Node/Bun)
- Shell scripts must start with "set -euo pipefail"
- Scripts accepting user input must detect if stdin is a TTY (sys.stdin.isatty() / process.stdin.isTTY) and include a non-interactive fallback that runs without crashing when stdin is empty
- Add a shebang line to all scripts (#!/usr/bin/env python3 or #!/usr/bin/env bash)
- Python: use specific exception types, never bare except
- After writing code, state that it should be verified by running it`
    : "";

  const reasonMessages = [
    {
      role: "system",
      content: `You are PandaClaw, a thoughtful AI agent.
For complex requests: think step by step before answering.
Put your reasoning in <think>...</think> tags, then give your final answer.${codeQualityAddendum}`,
    },
    // Last 4 messages for context
    ...task.conversationHistory.slice(-4),
    { role: "user", content: task.input },
  ];

  let rawResponse: string = "";
  let tokensUsed = 0;
  let reasonSucceeded = false;

  for (const pandaModel of pandaModels) {
    try {
      const reasonRes = await fetchWithRetry(`${config.providers.openrouter.api_base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${orKey}`,
          "HTTP-Referer": "https://github.com/senapati484/pandaclaw",
          "X-Title": "PandaClaw",
        },
        body: JSON.stringify({
          model: pandaModel,
          messages: sanitizeMessages(reasonMessages),
          max_tokens: maxTokens,
          temperature,
        }),
      });

      if (!reasonRes.ok) {
        const errText = await reasonRes.text();
        throw new Error(`OpenRouter ${reasonRes.status}: ${errText.slice(0, 200)}`);
      }

      const reasonData = (await reasonRes.json()) as LLMResponse;
      rawResponse = reasonData.choices[0]?.message?.content ?? "";
      tokensUsed = reasonData.usage?.total_tokens ?? 0;
      reasonSucceeded = true;
      break; // Success — stop trying fallbacks
    } catch (err: any) {
      console.warn(`[panda-mode] ${pandaModel} failed: ${err.message?.slice(0, 80)}`);
      // Continue to next fallback
    }
  }

  if (!reasonSucceeded) {
    // All OpenRouter models failed — use fast path
    const { runFastPath } = await import("./fast-path.js");
    const result = await runFastPath(task, config);
    return { ...result, durationMs: Date.now() - start };
  }

  // Extract final answer (strip <think> tags)
  const finalAnswer = rawResponse.includes("</think>")
    ? rawResponse.split("</think>").slice(1).join("</think>").trim()
    : rawResponse.trim();

  // ── STEP 2: VERIFY — Groq fast second opinion (best-effort, skipped if rate-limited) ──
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

      if (verifyRes.ok) {
        const verifyData = (await verifyRes.json()) as LLMResponse;
        const verdict = verifyData.choices[0]?.message?.content ?? "";
        verified = verdict.startsWith("PASS");
        verifiedAnswer = verified ? finalAnswer : verdict.replace(/^FIXED:\s*/i, "").trim();
      }
      // If Groq returns 429/non-ok, just skip verification — answer stands as-is
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
