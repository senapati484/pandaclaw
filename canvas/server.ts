import { initDynamicSkills } from "../tools/index.js";
await initDynamicSkills(process.cwd());

import { Gateway } from "../modes/gateway/index.js";
import { classifyRoute } from "../modes/ask/classifier.js";
import { initProviders } from "../ai/llm.js";
import { readConfig } from "../ai/ai.config.js";
import path from "path";
import { readFileSync } from "fs";

const config = readConfig();
initProviders(config);

const PORT = 18789;

// Instantiate the Gateway
const gateway = new Gateway();
gateway.start(["webchat"]);

// Start Heartbeat Scheduler
import { HeartbeatEngine } from "../utils/heartbeat.js";
const heartbeat = new HeartbeatEngine();
heartbeat.start();

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

function handleStaticFile(pathname: string): Response | null {
  const publicPath = path.join(__dirname, "public");
  if (pathname === "/" || pathname === "/index.html") {
    return new Response(readFileSync(path.join(publicPath, "index.html")), {
      headers: { "Content-Type": "text/html" },
    });
  }
  if (pathname === "/app.js") {
    return new Response(readFileSync(path.join(publicPath, "app.js")), {
      headers: { "Content-Type": "application/javascript" },
    });
  }
  if (pathname === "/app.css") {
    return new Response(readFileSync(path.join(publicPath, "app.css")), {
      headers: { "Content-Type": "text/css" },
    });
  }
  return null;
}

async function handleApiMessage(req: Request): Promise<Response> {
  const body: any = await req.json();
  broadcastLog({ type: "input", text: body.text });

  const route = classifyRoute(body.text);
  const ctx = { userId: body.chatId || "web_default", channel: "web" as const, workspacePath: "/", requestConsent: async () => true };

  let answer: string;
  if (route === "action") {
    const { runToolAgent } = await import("../modes/ask/tool-agent.js");
    const result = await runToolAgent(body.text, config, ctx);
    answer = result.answer;
  } else if (route === "complex") {
    const { runPandaMode } = await import("../modes/ask/panda-mode.js");
    const task = { id: crypto.randomUUID(), type: "complex" as const, input: body.text, conversationHistory: [], createdAt: new Date() };
    const result = await runPandaMode(task, config);
    answer = result.answer;
  } else {
    const { runFastPath } = await import("../modes/ask/fast-path.js");
    const task = { id: crypto.randomUUID(), type: "simple" as const, input: body.text, conversationHistory: [], createdAt: new Date() };
    const result = await runFastPath(task, config);
    answer = result.answer;
  }

  broadcastLog({ type: "output", text: answer });
  return new Response(JSON.stringify({ reply: answer }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleApiMessageStream(req: Request): Promise<Response> {
  const body: any = await req.json();
  const chatId = body.chatId || "web_default";
  broadcastLog({ type: "input", text: body.text });

  return createSSEStream(async (controller, encoder) => {
    const route = classifyRoute(body.text);

    if (route === "simple") {
      const { runFastPath } = await import("../modes/ask/fast-path.js");
      const task = { id: crypto.randomUUID(), type: "simple" as const, input: body.text, conversationHistory: [], createdAt: new Date() };
      const result = await runFastPath(task, config);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: result.answer })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    } else {
      const { runToolAgent } = await import("../modes/ask/tool-agent.js");
      const ctx = { userId: chatId, channel: "web" as const, workspacePath: "/", requestConsent: async () => true };

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
}

async function handleApiCanvas(req: Request): Promise<Response> {
  const body: any = await req.json();
  broadcastLog({ type: "canvas_update", action: body.action, data: body.data });
  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleWebhookPost(source: string, req: Request): Promise<Response> {
  try {
    const payload = await req.json();
    const headers: Record<string, string> = {};
    req.headers.forEach((val, key) => {
      headers[key] = val;
    });

    const { processWebhook } = await import("../modes/gateway/webhook.js");
    const result = await processWebhook(source, payload, headers);
    
    if (result.success) {
      return new Response(JSON.stringify({ success: true, answer: result.answer }), {
        headers: { "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({ success: false, error: result.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
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
    const staticRes = handleStaticFile(url.pathname);
    if (staticRes) return staticRes;

    // Webhook Ingestion Route
    if (url.pathname.startsWith("/webhook/") && req.method === "POST") {
      const source = url.pathname.slice(9);
      return handleWebhookPost(source, req);
    }

    // WebChat Endpoint (non-streaming - backward compatible)
    if (url.pathname === "/api/message" && req.method === "POST") {
      return handleApiMessage(req);
    }

    // WebChat Streaming Endpoint (SSE)
    if (url.pathname === "/api/message/stream" && req.method === "POST") {
      return handleApiMessageStream(req);
    }

    // Canvas Control Endpoint
    if (url.pathname === "/api/canvas" && req.method === "POST") {
      return handleApiCanvas(req);
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
