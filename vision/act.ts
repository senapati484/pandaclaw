// vision/act.ts
// Stage 4: Decide on a typed action based on reasoning

import type { VisionAction, VisionContentType } from "../modes/agent/types.js";
import type { PandaConfig } from "../ai/ai.config.js";

interface GroqResponse {
  choices: Array<{ message: { content: string } }>;
}

const PROMPT_TEMPLATE = (reasoning: string, contentType: VisionContentType) =>
  `Based on this reasoning about a ${contentType} image:

${reasoning}

Choose the BEST action type:
- describe: explain what's visible (for general descriptions)
- extract: pull structured data (for charts, tables, forms)
- diagnose: identify problem + fix (for errors, bugs)
- navigate: give UI navigation steps (for screenshot tasks)
- code_review: review code issues (for code screenshots)

Reply ONLY with valid JSON, no markdown:
{
  "type": "describe|extract|diagnose|navigate|code_review",
  "summary": "(for describe)",
  "data": {},
  "issue": "(for diagnose)",
  "fix": "(for diagnose)",
  "instruction": "(for navigate)",
  "findings": []
}`;

export async function decideAction(
  reasoning: string,
  contentType: VisionContentType,
  config: PandaConfig
): Promise<VisionAction> {
  const apiKey = config.providers.groq.api_key;
  const fastModel = config.routing.fast_path.model;
  const apiBase = config.providers.groq.api_base;

  // Offline fallback
  if (!apiKey) {
    return { type: "describe", summary: reasoning };
  }

  try {
    const res = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: fastModel,
        messages: [{ role: "user", content: PROMPT_TEMPLATE(reasoning, contentType) }],
        max_tokens: 512,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });

    const data = (await res.json()) as GroqResponse;
    const raw = data.choices[0]?.message?.content ?? "{}";

    // Strip markdown fences if model misbehaves
    const cleaned = raw.replace(/^```(json)?|```$/gm, "").trim();
    const parsed = JSON.parse(cleaned);
    return parsed as VisionAction;
  } catch {
    return { type: "describe", summary: reasoning };
  }
}
