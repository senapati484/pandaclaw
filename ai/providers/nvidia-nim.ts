// ai/providers/nvidia-nim.ts

import type { VisionContentType } from "../../modes/agent/types.js";

const NIM_BASE = "https://integrate.api.nvidia.com/v1";

interface NIMTextContent {
  type: "text";
  text: string;
}

interface NIMImageContent {
  type: "image_url";
  image_url: { url: string };
}

interface NIMMessage {
  role: "user" | "assistant" | "system";
  content: string | Array<NIMTextContent | NIMImageContent>;
}

interface NIMResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

export async function nimChat(
  messages: NIMMessage[],
  model: string,
  apiKey: string,
  maxTokens = 1024
): Promise<string> {
  const res = await fetch(`${NIM_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`NVIDIA NIM error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as NIMResponse;
  return data.choices[0]?.message?.content ?? "";
}

export async function nimVision(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
  model: string,
  apiKey: string
): Promise<string> {
  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const messages: NIMMessage[] = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: prompt },
      ],
    },
  ];

  return nimChat(messages, model, apiKey, 2048);
}

export function routeVisionModel(
  contentType: VisionContentType,
  routing: Record<string, unknown>
): { provider: string; model: string } {
  const map: Record<VisionContentType, string> = {
    screenshot: "vision_screenshot",
    document: "vision_document",
    chart: "vision_chart",
    code: "vision_code",
    general: "vision_screenshot",
  };
  const key = map[contentType];
  const entry = (routing[key] ?? routing["vision_screenshot"]) as { provider: string; model: string } | undefined;
  return entry ?? { provider: "nvidia_nim", model: "meta/llama-3.2-11b-vision-instruct" };
}
