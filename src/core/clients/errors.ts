import { AbortError } from "./abort.ts";
import { tryParseJson } from "./sse.ts";

/** Convert a fetch/stream error into a meaningful Error (preserving abort signals). */
export function normalizeFetchError(err: unknown): Error {
  if (err instanceof DOMException && err.name === "AbortError") return new AbortError();
  if (err instanceof Error) return err;
  return new Error(String(err));
}

/** Extract a human-readable message from a non-OK HTTP response body. */
export async function readErrorBody(response: Response): Promise<string> {
  try {
    const raw = await response.text();
    const json = tryParseJson<{ error?: { message?: string } | string }>(raw);
    if (json) {
      if (typeof json.error === "string") return json.error;
      if (json.error?.message) return json.error.message;
    }
    return raw.slice(0, 300);
  } catch {
    return "";
  }
}
