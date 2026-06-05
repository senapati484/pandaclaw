#!/usr/bin/env bun
// bin/mcp-server.ts
// Entry point that starts the PandaClaw MCP server on stdio.
// Run from anywhere: `bun bin/mcp-server.ts`
// or configure as a server in your host's MCP config.

import { MCPServer } from "../mcp/server.ts";

const debug = process.env.PANDACLAW_MCP_DEBUG === "1";
const server = new MCPServer({ debug });

// Graceful shutdown
const cleanup = () => {
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

server.serveStdio().catch((err) => {
  console.error("[mcp-server] fatal:", err);
  process.exit(1);
});
