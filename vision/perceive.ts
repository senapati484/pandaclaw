// vision/perceive.ts
// Stage 1: Detect what kind of image we're dealing with

import type { VisionContentType } from "../modes/agent/types.js";
import { nimVision, routeVisionModel } from "../ai/providers/nvidia-nim.js";
import type { PandaConfig } from "../ai/ai.config.js";

const PROMPT = `Look at this image carefully. Reply with EXACTLY one word from this list:
screenshot  (computer screen, terminal, browser, IDE, app UI)
document    (page of text, PDF, report, letter, article)
chart       (graphs, charts, plots, data visualization)
code        (source code, code editor, terminal with code output)
general     (anything else — photos, diagrams, illustrations)

Reply with only the single word. No explanation.`;

const VALID_TYPES: VisionContentType[] = [
  "screenshot",
  "document",
  "chart",
  "code",
  "general",
];

export async function detectContentType(
  imageBuffer: Buffer,
  mimeType: string,
  config: PandaConfig
): Promise<VisionContentType> {
  const { model, provider } = routeVisionModel("general", config.routing as unknown as Record<string, unknown>);
  const apiKey = config.providers[provider as keyof typeof config.providers]?.api_key;

  if (!apiKey) return "general"; // offline fallback

  try {
    const result = await nimVision(imageBuffer, mimeType, PROMPT, model, apiKey);
    const word = result.trim().toLowerCase().split(/\s+/)[0] ?? "general";
    return VALID_TYPES.includes(word as VisionContentType)
      ? (word as VisionContentType)
      : "general";
  } catch {
    return "general";
  }
}
