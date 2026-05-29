// ai/providers/nvidia-nim.ts
// NVIDIA NIM free-endpoint model routing.
// Each task type is mapped to the best free NIM model for that job.
// NIM does NOT support OpenAI function/tool calling — use for text + vision only.

import type { VisionContentType } from "../../modes/agent/types.js";

const NIM_BASE = "https://integrate.api.nvidia.com/v1";

// ── Free NIM model catalogue ────────────────────────────────────────────────
// Source: build.nvidia.com/models → "Free Endpoint" filter
export const NIM_MODELS = {
  // ── General / Agentic text ──────────────────────────────────────────────
  // Large MoE, best quality for reasoning, chat, agentic tasks
  chat_large:   "mistralai/mistral-large-3-675b-instruct-2512",

  // ── Vision / Multimodal ─────────────────────────────────────────────────
  // Excels at image + audio reasoning (screenshots, documents, UI analysis)
  vision_phi4:  "microsoft/phi-4-multimodal-instruct",
  // General vision comprehension (charts, photos)
  vision_pali:  "google/paligemma",
  // Llama vision as additional fallback
  vision_llama: "meta/llama-3.2-11b-vision-instruct",

  // ── Code ─────────────────────────────────────────────────────────────────
  // Optimised for code retrieval / generation tasks
  code_embed:   "nvidia/nv-embedcode-7b-v1",

  // ── Edge / Fast ──────────────────────────────────────────────────────────
  // 2B model for quick, lightweight responses
  edge_fast:    "google/gemma-2-2b-it",

  // ── Embeddings ───────────────────────────────────────────────────────────
  embed:        "nvidia/nv-embed-v1",

  // ── Reranking ────────────────────────────────────────────────────────────
  rerank:       "nvidia/rerank-qa-mistral-4b",
} as const;

// ── Vision content-type → best NIM model ───────────────────────────────────
// phi-4-multimodal is used for structured content (screenshots, documents, code)
// paligemma for general image comprehension
const VISION_ROUTE: Record<VisionContentType, string> = {
  screenshot: NIM_MODELS.vision_phi4,    // UI analysis — phi-4 excels
  document:   NIM_MODELS.vision_phi4,    // Text extraction from docs
  chart:      NIM_MODELS.vision_pali,    // Chart/graph understanding
  code:       NIM_MODELS.vision_phi4,    // Code screenshot analysis
  general:    NIM_MODELS.vision_pali,    // General image description
};

interface NIMTextContent  { type: "text";      text: string }
interface NIMImageContent { type: "image_url"; image_url: { url: string } }
interface NIMMessage {
  role: "user" | "assistant" | "system";
  content: string | Array<NIMTextContent | NIMImageContent>;
}
interface NIMResponse {
  choices: Array<{ message: { content: string } }>;
}

// ── Core chat call ──────────────────────────────────────────────────────────
export async function nimChat(
  messages: NIMMessage[],
  model: string,
  apiKey: string,
  maxTokens = 2048,
  temperature = 0.15
): Promise<string> {
  const res = await fetch(`${NIM_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: 1.0,
      stream: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`NVIDIA NIM error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as NIMResponse;
  return data.choices[0]?.message?.content ?? "";
}

// ── Vision call (image + text multimodal) ──────────────────────────────────
export async function nimVision(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
  model: string,
  apiKey: string
): Promise<string> {
  const base64  = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const messages: NIMMessage[] = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text",      text: prompt },
      ],
    },
  ];

  // phi-4-multimodal needs slightly higher token budget for image analysis
  return nimChat(messages, model, apiKey, 2048, 0.1);
}

// ── Route: vision content-type → NIM model ─────────────────────────────────
export function routeVisionModel(
  contentType: VisionContentType,
  _routing?: Record<string, unknown>   // kept for API compatibility
): { provider: string; model: string } {
  return {
    provider: "nvidia_nim",
    model:    VISION_ROUTE[contentType] ?? NIM_MODELS.vision_phi4,
  };
}

// ── Route: task type → best NIM text model ─────────────────────────────────
export function routeNimTextModel(
  taskType: "chat" | "code" | "edge" | "embed" | "rerank" = "chat"
): string {
  switch (taskType) {
    case "code":   return NIM_MODELS.code_embed;
    case "edge":   return NIM_MODELS.edge_fast;
    case "embed":  return NIM_MODELS.embed;
    case "rerank": return NIM_MODELS.rerank;
    default:       return NIM_MODELS.chat_large;   // mistral-large-3 for general tasks
  }
}
