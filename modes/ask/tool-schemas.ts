/**
 * tool-schemas.ts
 * OpenAI-compatible tool schemas for the PandaClaw tool agent.
 * Extracted from tool-agent.ts for easier maintenance and readability.
 */

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "file_read",
      description: "Read any file on the device. Use absolute paths.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_write",
      description: "Write or create any file. Creates parent dirs automatically.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path" },
          content: { type: "string", description: "Full file content" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and folders in a directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path" },
          recursive: { type: "boolean", description: "List recursively" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_exec",
      description: "Execute any shell command on the device.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Shell command" },
          timeout: { type: "number", description: "Timeout ms" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information on any topic.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "alarm_set",
      description: "Set an alarm or reminder on macOS.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Alarm message" },
          time: { type: "string", description: "HH:MM or 10m/30s/1h" },
        },
        required: ["message", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_recall",
      description: "Recall past conversations and facts from memory.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to recall" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "app_control",
      description: "Control macOS apps, system settings, browsers, and keyboard input.",
      parameters: {
        type: "object",
        properties: {
          app: {
            type: "string",
            enum: ["chrome", "safari", "youtube", "system", "browser_action", "keyboard"],
          },
          action: {
            type: "string",
            enum: [
              "open_url", "search", "resolve_latest", "vscode", "service",
              "volume", "brightness", "clipboard", "scroll", "navigate",
              "list_tabs", "switch_tab", "type", "press_key",
            ],
          },
          url: { type: "string", description: "URL to open" },
          query: { type: "string", description: "Search query" },
          channel: { type: "string", description: "YT channel" },
          folder: { type: "string", description: "Folder path" },
          service: { type: "string", description: "Service name" },
          state: { type: "string", enum: ["start", "stop"] },
          value: { type: "number", description: "0-100" },
          subAction: { type: "string", enum: ["read", "write"] },
          text: { type: "string", description: "Text to type" },
          browser: { type: "string", enum: ["chrome", "safari"] },
          direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
          navigateAction: {
            type: "string",
            enum: ["back", "forward", "refresh", "close_tab"],
          },
          target: { type: "string", description: "Tab index/title" },
          key: { type: "string", description: "Key name" },
          modifiers: {
            type: "array",
            items: {
              type: "string",
              enum: ["command", "option", "control", "shift", "cmd", "alt", "ctrl"],
            },
          },
        },
        required: ["app", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "canvas_control",
      description: "Draw shapes or display HTML on the canvas dashboard.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["draw_rect", "render_html", "clear_canvas"],
          },
          x: { type: "number", description: "X coord" },
          y: { type: "number", description: "Y coord" },
          width: { type: "number" },
          height: { type: "number" },
          color: { type: "string", description: "CSS color" },
          lineWidth: { type: "number" },
          label: { type: "string" },
          html: { type: "string", description: "HTML content" },
          clearFirst: { type: "boolean" },
        },
        required: ["action"],
      },
    },
  },
] as const;
