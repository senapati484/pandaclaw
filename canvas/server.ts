import { initDynamicSkills } from "../tools/index.js";
await initDynamicSkills(process.cwd());

import { Gateway } from "../modes/gateway/index.js";
import { classifyRoute } from "../modes/ask/classifier.js";
import { callLLM, initProviders } from "../ai/llm.js";
import { readConfig } from "../ai/ai.config.js";
import path from "path";
import { readFileSync, existsSync } from "fs";

const config = readConfig();
initProviders(config);

const PORT = 18789;

// Instantiate the Gateway
const gateway = new Gateway();
gateway.start(["webchat"]);

// Broadcast helper for logs
const activeWebSockets = new Set<any>();
export function broadcastLog(log: any) {
  const payload = JSON.stringify(log);
  for (const ws of activeWebSockets) {
    try {
      ws.send(payload);
    } catch {}
  }
}

function createSSEStream(handler: (controller: ReadableStreamDefaultController, encoder: TextEncoder) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      handler(controller, encoder).catch((err) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {}
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const success = server.upgrade(req);
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Static files routing
    const publicPath = path.join(__dirname, "public");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(readFileSync(path.join(publicPath, "index.html")), {
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.pathname === "/app.js") {
      return new Response(readFileSync(path.join(publicPath, "app.js")), {
        headers: { "Content-Type": "application/javascript" },
      });
    }
    if (url.pathname === "/app.css") {
      return new Response(readFileSync(path.join(publicPath, "app.css")), {
        headers: { "Content-Type": "text/css" },
      });
    }

    // WebChat Endpoint (non-streaming - backward compatible)
    if (url.pathname === "/api/message" && req.method === "POST") {
      return req.json().then(async (body: any) => {
        broadcastLog({ type: "input", text: body.text });

        const { runToolAgent } = await import("../modes/ask/tool-agent.js");
        const ctx = { userId: body.chatId || "web_default", channel: "web" as const, workspacePath: process.cwd(), requestConsent: async () => true };
        const result = await runToolAgent(body.text, config, ctx);
        broadcastLog({ type: "output", text: result.answer });

        return new Response(JSON.stringify({ reply: result.answer }), {
          headers: { "Content-Type": "application/json" },
        });
      });
    }

    // WebChat Streaming Endpoint (SSE)
    if (url.pathname === "/api/message/stream" && req.method === "POST") {
      return req.json().then((body: any) => {
        const chatId = body.chatId || "web_default";
        broadcastLog({ type: "input", text: body.text });

        return createSSEStream(async (controller, encoder) => {
          const route = classifyRoute(body.text);
          const isKnowledgeQuery = /\b(what|who|when|where|why|how|explain|define|describe|tell me|do you know)\b/i.test(body.text);
          let webResults = "";

          // Proactively search the web for knowledge queries
          if (isKnowledgeQuery) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ p: "🔍 Searching the web" })}\n\n`));
            try {
              const { runTool } = await import("../tools/index.js");
              const searchCtx = { userId: chatId, channel: "web" as const, workspacePath: process.cwd(), requestConsent: async () => true };
              const result = await runTool("web_search", { query: body.text }, searchCtx as any);
              if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                webResults = result.data.map((r: any) => `- ${r.title}: ${r.snippet} (${r.url})`).join("\n");
              }
            } catch {}
          }

          const webContext = webResults
            ? `Here are some web search results to help answer the user's question:\n${webResults}\n\nUse these to provide an accurate, up-to-date answer.`
            : "";

          if (route === "simple") {
            await callLLM(config, {
              messages: [
                { role: "system", content: `You are PandaClaw, a helpful AI assistant. Keep answers concise and accurate.\n${webContext}`.trim() },
                { role: "user", content: body.text },
              ],
              stream: true,
              onChunk: (chunk) => {
                if (chunk.type === "text" && chunk.content) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: chunk.content })}\n\n`));
                }
              },
              useCache: false,
            });

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } else {
            const { runToolAgent } = await import("../modes/ask/tool-agent.js");
            const ctx = { userId: chatId, channel: "web" as const, workspacePath: process.cwd(), requestConsent: async () => true };

            await runToolAgent(body.text, config, ctx, (chunk: any) => {
              if (chunk.type === "progress") {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ p: chunk.text })}\n\n`));
              } else if (chunk.type === "text") {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: chunk.text })}\n\n`));
              }
            });

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }

          broadcastLog({ type: "output", text: `[streamed response]` });
        });
      });
    }

    // Canvas Control Endpoint
    if (url.pathname === "/api/canvas" && req.method === "POST") {
      return req.json().then((body: any) => {
        broadcastLog({ type: "canvas_update", action: body.action, data: body.data });
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        });
      });
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws) {
      activeWebSockets.add(ws);
    },
    message(ws, msg) {
      // Echo back or handle client actions
    },
    close(ws) {
      activeWebSockets.delete(ws);
    }
  }
});

console.log(`🐼 Visual Canvas Dashboard running at http://localhost:${PORT}`);
export { server };
