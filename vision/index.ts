// vision/index.ts
// 4-stage vision pipeline: Perceive → Locate → Reason → Act

import type {
  VisionResult,
  VisionContentType,
  SpatialElement,
} from "../modes/agent/types.js";
import { detectContentType } from "./perceive.js";
import { reasonAboutContent } from "./reason.js";
import { decideAction } from "./act.js";
import { nimVision, routeVisionModel } from "../ai/providers/nvidia-nim.js";
import { readConfig } from "../ai/ai.config.js";

// ── Prompt library for Stage 2 (LOCATE) ──
const LOCATE_PROMPTS: Record<VisionContentType, string> = {
  screenshot: `Analyze this screenshot. List every visible UI element:
- type (button/input/text/error/nav/image/table/modal)
- label or text content
- position (top/middle/bottom, left/center/right)
- any error states
Format each as: TYPE | LABEL | POSITION | STATE`,

  document: `Extract all text from this document. Preserve structure:
- H: for headings
- P: for paragraphs
- T: for table rows
- F: for figure captions
Return text in document order.`,

  chart: `Analyze this chart/graph:
- Chart type (bar/line/pie/scatter)
- Title and axis labels
- Data series names
- Key data points and values
- Notable trends or anomalies
Format: TYPE | LABEL | VALUE`,

  code: `Analyze this code screenshot:
- Programming language
- File name (if visible)
- Error lines (line numbers if shown)
- Error messages or stack traces
- Highlighted or important lines
Format: TYPE | CONTENT | LINE`,

  general: `Describe this image elements:
- Main subjects
- Key visual elements
- Any visible text
- Colors and layout
Format: TYPE | DESCRIPTION | POSITION`,
};

function parseElements(rawText: string): SpatialElement[] {
  const lines = rawText.split("\n").filter((l) => l.trim());
  return lines.map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    return {
      type: parts[0] ?? "unknown",
      label: parts[1] ?? line,
      text: parts[1] ?? line,
      confidence: 0.85,
    };
  });
}

export async function runVisionPipeline(
  imageBuffer: Buffer,
  mimeType: string,
  userContext: string
): Promise<VisionResult> {
  const config = readConfig();

  // Stage 1: PERCEIVE — what kind of image?
  const contentType = await detectContentType(imageBuffer, mimeType, config);

  // Stage 2: LOCATE — extract spatial structure
  const { model: visionModel, provider } = routeVisionModel(contentType, config.routing as unknown as Record<string, unknown>);
  const apiKey = config.providers[provider as keyof typeof config.providers]?.api_key;

  let elements: SpatialElement[] = [];
  if (apiKey) {
    try {
      const locatePrompt = LOCATE_PROMPTS[contentType];
      const rawLocation = await nimVision(imageBuffer, mimeType, locatePrompt, visionModel, apiKey);
      elements = parseElements(rawLocation);
    } catch {
      // Proceed with empty elements — reason and act can still work
    }
  }

  // Stage 3: REASON — what does this mean?
  const reasoning = await reasonAboutContent(elements, contentType, userContext, config);

  // Stage 4: ACT — emit a typed action
  const action = await decideAction(reasoning, contentType, config);

  return {
    contentType,
    elements,
    reasoning,
    action,
    modelUsed: visionModel,
  };
}
