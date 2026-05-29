import { Gateway } from "../modes/gateway/index.js";
import path from "path";
import { readFileSync, existsSync } from "fs";

const PORT = 18789;

// Instantiate the Gateway
const gateway = new Gateway();
gateway.start();

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

    // WebChat Endpoint
    if (url.pathname === "/api/message" && req.method === "POST") {
      return req.json().then(async (body: any) => {
        const webchat = gateway.getAdapter("webchat") as any;
        if (!webchat) return new Response("WebChat offline", { status: 500 });
        
        broadcastLog({ type: "input", text: body.text });
        const reply = await webchat.handleUserMessage(body.text, body.chatId || "web_default");
        broadcastLog({ type: "output", text: reply });

        return new Response(JSON.stringify({ reply }), {
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
