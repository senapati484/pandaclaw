// mcp/protocol.ts
// Model Context Protocol — JSON-RPC 2.0 over stdio.
// Reference: https://modelcontextprotocol.io/specification/2024-11-05/

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// ============ Standard JSON-RPC 2.0 Error Codes ============

export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // MCP-specific codes (within -32000 to -32099)
  ServerNotInitialized: -32002,
  UnknownProtocolVersion: -32001,
} as const;

// ============ MCP Standard Method Names ============

export const MCPMethod = {
  Initialize: "initialize",
  Ping: "ping",
  ToolsList: "tools/list",
  ToolsCall: "tools/call",
  ResourcesList: "resources/list",
  ResourcesRead: "resources/read",
  PromptsList: "prompts/list",
  PromptsGet: "prompts/get",
  NotificationsInitialized: "notifications/initialized",
} as const;

export const LATEST_PROTOCOL_VERSION = "2024-11-05";

export interface MCPServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: {};
}

export interface MCPClientCapabilities {
  sampling?: {};
  roots?: { listChanged?: boolean };
}

export interface InitializeParams {
  protocolVersion: string;
  capabilities: MCPClientCapabilities;
  clientInfo: { name: string; version: string };
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: MCPServerCapabilities;
  serverInfo: { name: string; version: string };
  instructions?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface CallToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; text: string; mimeType?: string } }
  >;
  isError?: boolean;
}

// ============ Stdio Transport ============

const HEADER_SEPARATOR = "\r\n\r\n";

/**
 * Encode a single JSON-RPC message with a Content-Length header (LSP-style framing).
 * MCP uses the same framing as LSP: line-delimited JSON-RPC over stdio.
 */
export function encodeMessage(message: object): string {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}${HEADER_SEPARATOR}`;
  return header + body;
}

/**
 * Read messages from a stream. Returns an async iterator that yields parsed
 * JSON-RPC messages one at a time. Throws on framing errors.
 */
export async function* readMessages(
  input: ReadableStream<Uint8Array> | NodeJS.ReadableStream
): AsyncGenerator<JsonRpcRequest | JsonRpcResponse | JsonRpcNotification> {
  let buffer = "";
  const decoder = new TextDecoder("utf-8");

  for await (const chunk of input as AsyncIterable<Uint8Array | Buffer | string>) {
    let text: string;
    if (typeof chunk === "string") {
      text = chunk;
    } else if (chunk instanceof Uint8Array) {
      // Uint8Array.toString() returns comma-separated bytes, not a UTF-8 string.
      text = decoder.decode(chunk, { stream: true });
    } else {
      // Node.js Buffer
      text = (chunk as Buffer).toString("utf-8");
    }
    buffer += text;

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf(HEADER_SEPARATOR)) !== -1) {
      const header = buffer.slice(0, sepIndex);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(sepIndex + HEADER_SEPARATOR.length);
        continue;
      }

      const contentLength = parseInt(match[1]!, 10);
      const bodyStart = sepIndex + HEADER_SEPARATOR.length;
      if (buffer.length < bodyStart + contentLength) {
        break; // wait for more data
      }

      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);

      try {
        const parsed = JSON.parse(body);
        yield parsed;
      } catch (err) {
        throw new Error(`Failed to parse MCP message: ${(err as Error).message}`);
      }
    }
  }
}

/**
 * Write a message to a writable stream.
 */
export async function writeMessage(
  output: WritableStream<Uint8Array> | NodeJS.WritableStream,
  message: object
): Promise<void> {
  const encoded = encodeMessage(message);

  if (output instanceof WritableStream) {
    const writer = output.getWriter();
    await writer.write(new TextEncoder().encode(encoded));
    await writer.releaseLock();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const nodeStream = output as NodeJS.WritableStream;
    if (typeof nodeStream.write === "function") {
      nodeStream.write(encoded, "utf8", (err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      reject(new Error("Stream is not writable"));
    }
  });
}

export function isRequest(value: any): value is JsonRpcRequest {
  return value && value.jsonrpc === "2.0" && typeof value.method === "string" && "id" in value;
}

export function isNotification(value: any): value is JsonRpcNotification {
  return value && value.jsonrpc === "2.0" && typeof value.method === "string" && !("id" in value);
}

export function isResponse(value: any): value is JsonRpcResponse {
  return (
    value &&
    value.jsonrpc === "2.0" &&
    !("method" in value) &&
    ("result" in value || "error" in value)
  );
}
