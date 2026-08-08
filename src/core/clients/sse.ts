// Minimal Server-Sent-Events parser for OpenAI / Anthropic streaming responses.
import type { AbortSignalLike } from "./abort.ts";

export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Parse an SSE stream from a web ReadableStream.
 * Yields one object per event. Handles CRLF, multi-line data and [DONE].
 */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignalLike,
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName: string | undefined;

  const abortListener = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abortListener);

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
          // Event boundary
          if (eventName !== undefined || buffer.trim() !== "") {
            // flush only if we have pending data; otherwise a blank line is a no-op
          }
          if (eventName !== undefined) {
            yield { event: eventName, data: "" };
            eventName = undefined;
          }
          continue;
        }
        if (line.startsWith(":")) continue; // comment
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data) yield { event: eventName, data };
        }
      }
    }

    // Flush trailing data after stream end
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data:")) {
        const data = trimmed.slice(5).trim();
        if (data) yield { event: eventName, data };
      }
    }
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
