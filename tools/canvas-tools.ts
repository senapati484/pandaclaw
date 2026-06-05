import type { ToolDefinition } from "../modes/agent/types.js";

export const canvasControlTool: ToolDefinition = {
  name: "canvas_control",
  description: "Update the live Visual Canvas dashboard. Draw shapes, display HTML cards, or clear the canvas.",
  riskLevel: "safe",
  readOnly: false,
  execute: async (args) => {
    const action = String(args.action ?? "");
    if (!action) {
      throw new Error("Missing 'action' parameter for canvas_control.");
    }

    const payload = {
      action,
      data: {
        x: args.x !== undefined ? Number(args.x) : undefined,
        y: args.y !== undefined ? Number(args.y) : undefined,
        width: args.width !== undefined ? Number(args.width) : undefined,
        height: args.height !== undefined ? Number(args.height) : undefined,
        color: args.color !== undefined ? String(args.color) : undefined,
        lineWidth: args.lineWidth !== undefined ? Number(args.lineWidth) : undefined,
        label: args.label !== undefined ? String(args.label) : undefined,
        html: args.html !== undefined ? String(args.html) : undefined,
        clearFirst: args.clearFirst === true,
      }
    };

    try {
      const res = await fetch("http://localhost:18789/api/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      return {
        success: true,
        message: `Canvas action '${action}' dispatched successfully.`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Visual Canvas dashboard server is not running on port 18789. Run 'bun run canvas/server.ts' to enable canvas rendering. Details: ${err.message}`,
      };
    }
  },
};
