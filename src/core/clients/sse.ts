// Minimal Server-Sent-Events parser for OpenAI / Anthropic streaming responses.
import type { AbortSignalLike } from "./abort.ts";

export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Parse an SSE stream from a web ReadableStream.
 * Yields one object per event, joining multi-line `data:` fields with "\n"
 * per the SSE spec. Handles CRLF and [DONE].
 */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignalLike,
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const abortListener = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abortListener);

  const flushEvent = (): string | null => {
    if (dataLines.length === 0) return null;
    const data = dataLines.join("\n");
    dataLines = [];
    return data;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);

        if (line === "") {
          // Event boundary — flush any accumulated data lines.
          const name = eventName;
          eventName = undefined;
          const data = flushEvent();
          if (data) yield { event: name, data };
          continue;
        }
        if (line.startsWith(":")) continue; // comment
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
          continue;
        }
      }
    }

    // Flush trailing data after stream end.
    if (buffer.trim().startsWith("data:")) {
      dataLines.push(buffer.trim().slice(5).replace(/^ /, ""));
    }
    const trailing = flushEvent();
    if (trailing) yield { event: eventName, data: trailing };
  } finally {
    signal?.removeEventListener("abort", abortListener);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/** Parse a JSON string, returning null on failure. */
export function tryParseJson<T = unknown>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
