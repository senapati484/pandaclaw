// vision/reason.ts
// Stage 3: Reason about the image elements in context

import type { SpatialElement, VisionContentType } from "../modes/agent/types.js";
import type { PandaConfig } from "../ai/ai.config.js";

interface GroqResponse {
  choices: Array<{ message: { content: string } }>;
}

export async function reasonAboutContent(
  elements: SpatialElement[],
  contentType: VisionContentType,
  userContext: string,
  config: PandaConfig
): Promise<string> {
  const apiKey = config.providers.groq.api_key;
  const apiBase = config.providers.groq.api_base;

  // Offline fallback — no API key
  if (!apiKey) {
    return `Detected ${contentType} image with ${elements.length} elements. Context: "${userContext}"`;
  }

  const elementSummary = elements
    .slice(0, 20)
    .map((e) => `- ${e.type}: ${e.label ?? e.text ?? ""}`)
    .join("\n");

  const systemPrompt = `You are a visual reasoning assistant.
Given what is visible in an image, reason about its meaning and what the user likely needs.
Be specific and actionable. Focus on what matters for the user's context.`;

  const userPrompt = `Image type: ${contentType}
User question/context: "${userContext}"

Elements detected:
${elementSummary || "(no structured elements extracted)"}

Reason step by step:
1. What is the current state shown in this image?
2. What problem or situation is present?
3. What does the user most likely need?
4. What is the most helpful response?

Provide a clear, actionable reasoning.`;

  try {
    const res = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1024,
        temperature: 0.2,
      }),
    });

    const data = (await res.json()) as GroqResponse;
    return data.choices[0]?.message?.content ?? "Could not reason about image content.";
  } catch {
    return `Image type: ${contentType}. ${elements.length} elements detected. Context: ${userContext}`;
  }
}
