// Anthropic Messages API client.
import type { Endpoint, ToolCallInfo, Usage } from "../types.ts";
import { resolveApiKey } from "../pricing.ts";
import type { AbortSignalLike } from "./abort.ts";
import { AbortError, throwIfAborted } from "./abort.ts";
import type { ChatMsg, LLMClient, StreamCallbacks, StreamRequest, StreamResult, ToolDef } from "./client.ts";
import { sseEvents, tryParseJson } from "./sse.ts";

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicStreamEvent {
  type?: string;
  message?: {
    usage?: AnthropicUsage;
  };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    text?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: AnthropicUsage;
  error?: { type?: string; message?: string };
}

function buildUrl(endpoint: Endpoint): string {
  const base = endpoint.baseUrl.replace(/\/+$/, "");
  if (/\/messages$/.test(base)) return base;
  return `${base}/messages`;
}

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

function toBlocks(m: ChatMsg, useCache: boolean, isLastUser: boolean): Block[] {
  if (m.role === "assistant") {
    const blocks: Block[] = [];
    if (m.content) blocks.push({ type: "text", text: m.content });
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: parseJsonObj(tc.input) });
      }
    }
    return blocks;
  }
  if (m.role === "tool") {
    if (m.toolResults && m.toolResults.length > 0) {
      return m.toolResults.map((r) => ({ type: "tool_result", tool_use_id: r.toolCallId, content: r.content }));
    }
    return [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content }];
  }
  const block: Block = { type: "text", text: m.content };
  if (useCache && isLastUser && m.role === "user") {
    return [{ ...block, type: "text", text: m.content }];
  }
  return [block];
}

function parseJsonObj(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    if (typeof v === "object" && v !== null) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

function buildBody(endpoint: Endpoint, request: StreamRequest): Record<string, unknown> {
  const systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [];
  if (request.system?.trim()) {
    systemBlocks.push({ type: "text", text: request.system });
  }
  if (request.useCache) {
    for (const sb of systemBlocks) sb.cache_control = { type: "ephemeral" };
  }

  const messages = request.messages.map((m, i, arr) => {
    const isLastUser = i === arr.length - 1 && m.role === "user";
    return { role: m.role === "tool" ? "user" : m.role, content: toBlocks(m, !!request.useCache, isLastUser) };
  });
  const body: Record<string, unknown> = {
    model: request.model ?? endpoint.model,
    stream: true,
    max_tokens: request.maxTokens ?? 1024,
  };
  if (request.temperature != null) body.temperature = request.temperature;
  if (systemBlocks.length > 0) body.system = systemBlocks;
  if (messages.length > 0) body.messages = messages;
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }
  if (request.toolChoice != null) body.tool_choice = request.toolChoice;
  return body;
}

function usageFrom(u: AnthropicUsage | undefined): Usage | null {
  if (!u) return null;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Anthropic reports usage in pieces (message_start vs message_delta) — merge non-zero fields. */
function mergeUsage(base: Usage | null, next: Usage | null): Usage {
  const b = base ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  if (!next) return b;
  return {
    inputTokens: next.inputTokens > 0 ? next.inputTokens : b.inputTokens,
    outputTokens: next.outputTokens > 0 ? next.outputTokens : b.outputTokens,
    cacheReadTokens: next.cacheReadTokens > 0 ? next.cacheReadTokens : b.cacheReadTokens,
    cacheWriteTokens: next.cacheWriteTokens > 0 ? next.cacheWriteTokens : b.cacheWriteTokens,
  };
}

export class AnthropicClient implements LLMClient {
  readonly provider = "anthropic" as const;
  constructor(readonly endpoint: Endpoint) {}

  async stream(
    request: StreamRequest,
    callbacks: StreamCallbacks = {},
    signal?: AbortSignalLike,
  ): Promise<StreamResult> {
    try {
      return await this.doStream(request, callbacks, signal);
    } catch (err) {
      if (request.temperature != null && err instanceof Error && /temperature/i.test(err.message)) {
        return this.doStream({ ...request, temperature: undefined }, callbacks, signal);
      }
      throw err;
    }
  }

  private async doStream(
    request: StreamRequest,
    callbacks: StreamCallbacks = {},
    signal?: AbortSignalLike,
  ): Promise<StreamResult> {
    const started = performance.now();
    let headersMs: number | null = null;
    let ttftMs: number | null = null;
    let text = "";
    let reasoningText = "";
    let usage: Usage | null = null;
    let stopReason: string | undefined;
    let currentTool: { id: string; name: string; input: string } | null = null;
    const toolCalls: ToolCallInfo[] = [];

    const url = buildUrl(this.endpoint);
    const apiKey = resolveApiKey(this.endpoint.apiKey);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody(this.endpoint, request)),
        signal: signal as AbortSignal | undefined,
      });
    } catch (err) {
      throw normalizeFetchError(err);
    }
    headersMs = performance.now() - started;
    callbacks.onHeaders?.(headersMs);

    if (!response.ok) {
      const detail = await readErrorBody(response);
      throw new Error(`HTTP ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`);
    }
    if (!response.body) throw new Error("Empty response body");

    const contentType = response.headers.get("content-type") ?? "";
    throwIfAborted(signal);

    if (!contentType.includes("text/event-stream")) {
      // Non-streaming fallback.
      const json = (await response.json()) as {
        content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        stop_reason?: string;
        usage?: AnthropicUsage;
        error?: { message?: string };
      };
      if (json.error?.message) throw new Error(json.error.message);
      for (const block of json.content ?? []) {
        if (block.type === "text" && block.text) {
          if (ttftMs === null) {
            ttftMs = performance.now() - started;
            callbacks.onFirstToken?.(ttftMs);
          }
          text += block.text;
          callbacks.onDelta?.(block.text);
        } else if (block.type === "tool_use") {
          const tc = { id: block.id ?? "", name: block.name ?? "", input: JSON.stringify(block.input ?? {}) };
          ttftMs ??= performance.now() - started;
          callbacks.onFirstToken?.(ttftMs);
          callbacks.onToolCall?.(tc);
          toolCalls.push(tc);
        }
      }
      usage = usageFrom(json.usage);
      stopReason = json.stop_reason;
      callbacks.onUsage?.(usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason);
      callbacks.onDone?.();
      return finalize();
    }

    try {
      for await (const ev of sseEvents(response.body, signal)) {
        throwIfAborted(signal);
        const event = tryParseJson<AnthropicStreamEvent>(ev.data);
        if (!event) continue;
        switch (event.type) {
          case "message_start": {
            const u = usageFrom(event.message?.usage);
            if (u) {
              usage = mergeUsage(usage, u);
              callbacks.onUsage?.(usage);
            }
            break;
          }
          case "content_block_start": {
            const cb = event.content_block;
            if (cb?.type === "tool_use") {
              currentTool = { id: cb.id ?? "", name: cb.name ?? "", input: "" };
              if (ttftMs === null) {
                ttftMs = performance.now() - started;
                callbacks.onFirstToken?.(ttftMs);
              }
              const tc: ToolCallInfo = { id: currentTool.id, name: currentTool.name, input: "{}" };
              callbacks.onToolCall?.(tc);
            } else if (cb?.type === "thinking") {
              if (ttftMs === null) {
                ttftMs = performance.now() - started;
                callbacks.onFirstToken?.(ttftMs);
              }
            } else if (cb?.text) {
              if (ttftMs === null) {
                ttftMs = performance.now() - started;
                callbacks.onFirstToken?.(ttftMs);
              }
              text += cb.text;
              callbacks.onDelta?.(cb.text);
            }
            break;
          }
          case "content_block_delta": {
            const d = event.delta;
            if (!d) break;
            if (d.type === "text_delta" && d.text) {
              if (ttftMs === null) {
                ttftMs = performance.now() - started;
                callbacks.onFirstToken?.(ttftMs);
              }
              text += d.text;
              callbacks.onDelta?.(d.text);
            } else if (d.type === "thinking_delta" && d.thinking) {
              if (ttftMs === null) {
                ttftMs = performance.now() - started;
                callbacks.onFirstToken?.(ttftMs);
              }
              reasoningText += d.thinking;
              callbacks.onReasoningDelta?.(d.thinking);
            } else if (d.type === "input_json_delta" && d.partial_json && currentTool) {
              currentTool.input += d.partial_json;
              callbacks.onToolCall?.({ id: currentTool.id, name: currentTool.name, input: currentTool.input });
            }
            break;
          }
          case "content_block_stop": {
            if (currentTool) {
              toolCalls.push({ id: currentTool.id, name: currentTool.name, input: currentTool.input || "{}" });
              currentTool = null;
            }
            break;
          }
          case "message_delta": {
            if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
            const u = usageFrom(event.usage);
            if (u) {
              usage = mergeUsage(usage, u);
              callbacks.onUsage?.(usage, stopReason);
            }
            break;
          }
          case "message_stop":
            break;
          case "error":
            throw new Error(event.error?.message ?? "Anthropic API error");
          default:
            break;
        }
      }
    } catch (err) {
      if (signal?.aborted) throw new AbortError();
      throw err;
    }

    usage ??= { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    callbacks.onUsage?.(usage, stopReason);
    callbacks.onDone?.();
    return finalize();

    function finalize(): StreamResult {
      return {
        usage: usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason,
        text,
        reasoningText,
        toolCalls,
        ttftMs,
        headersMs,
      };
    }
  }
}

function normalizeFetchError(err: unknown): Error {
  if (err instanceof DOMException && err.name === "AbortError") return new AbortError();
  if (err instanceof Error) return err;
  return new Error(String(err));
}

async function readErrorBody(response: Response): Promise<string> {
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
