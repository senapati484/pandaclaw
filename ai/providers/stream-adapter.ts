export interface StreamChunk {
  type: "text" | "tool_call" | "tool_result" | "error" | "done";
  content?: string;
  toolName?: string;
  toolArgs?: string;
  toolCallId?: string;
  error?: string;
}

export type StreamHandler = (chunk: StreamChunk) => void;

export async function streamCompletion(
  apiBase: string,
  apiKey: string,
  model: string,
  messages: any[],
  onChunk: StreamHandler,
  options?: {
    temperature?: number;
    max_tokens?: number;
    tools?: any[];
    signal?: AbortSignal;
  }
): Promise<void> {
  const res = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: options?.tools,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.max_tokens,
      stream: true,
    }),
    signal: options?.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    onChunk({ type: "error", error: `Stream request failed (${res.status}): ${errText}` });
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onChunk({ type: "error", error: "No response body" });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6).trim();

        if (data === "[DONE]") {
          onChunk({ type: "done" });
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            onChunk({ type: "text", content: delta.content });
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              onChunk({
                type: "tool_call",
                toolName: tc.function?.name,
                toolArgs: tc.function?.arguments,
                toolCallId: tc.id,
              });
            }
          }
        } catch {}
      }
    }
  } catch (err: any) {
    if (err.name !== "AbortError") {
      onChunk({ type: "error", error: err.message });
    }
  } finally {
    reader.releaseLock();
  }

  onChunk({ type: "done" });
}

export async function* streamCompletionAsync(
  apiBase: string,
  apiKey: string,
  model: string,
  messages: any[],
  options?: {
    temperature?: number;
    max_tokens?: number;
    tools?: any[];
    signal?: AbortSignal;
  }
): AsyncGenerator<StreamChunk> {
  const resolveFns: Array<(chunk: StreamChunk) => void> = [];
  let pushResolve: ((chunk: StreamChunk) => void) | null = null;

  const onChunk = (chunk: StreamChunk) => {
    if (pushResolve) {
      pushResolve(chunk);
      pushResolve = null;
    }
  };

  const promise = new Promise<void>((resolve) => {
    const checkDone = () => {
      if (!pushResolve) {
        resolve();
      }
    };

    const interval = setInterval(checkDone, 100);
    streamCompletion(apiBase, apiKey, model, messages, (chunk) => {
      onChunk(chunk);
      if (chunk.type === "done") {
        clearInterval(interval);
        resolve();
      }
    }, options);
  });

  while (true) {
    const chunk = await new Promise<StreamChunk>((resolve) => {
      pushResolve = resolve;
    });
    if (chunk.type === "done") break;
    yield chunk;
  }

  await promise;
}
