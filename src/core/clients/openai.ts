// OpenAI-compatible chat completions client (works with OpenAI, vLLM, Ollama, LM Studio, Together, Groq, etc.)
import type { Endpoint, Usage, ToolCallInfo } from "../types.ts";
import { resolveApiKey } from "../pricing.ts";
import type { AbortSignalLike } from "./abort.ts";
import { AbortError, throwIfAborted } from "./abort.ts";
import type { ChatMsg, LLMClient, StreamCallbacks, StreamRequest, StreamResult, ToolDef } from "./client.ts";
import { withSystemMessage } from "./client.ts";
import { normalizeFetchError, readErrorBody } from "./errors.ts";
import { sseEvents, tryParseJson } from "./sse.ts";

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/** Append a tool-call name fragment, ignoring fragments already present (some providers resend full names). */
function accumulateName(existing: string, frag: string): string {
  if (!frag) return existing;
  if (!existing) return frag;
  return existing.includes(frag) ? existing : existing + frag;
}

/** Derive a numeric accumulator slot from a tool-call id (e.g. "call_0abc" -> 0), else null. */
function slotFromId(id: string | undefined): number | null {
  if (!id) return null;
  const m = id.match(/\d+/);
  return m ? Number(m[0]) : null;
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: OpenAIToolCallDelta[];
      reasoning_content?: string | null;
    };
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
    index?: number;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  error?: { message?: string };
}

function buildUrl(endpoint: Endpoint): string {
  const base = endpoint.baseUrl.replace(/\/+$/, "");
  // Allow baseUrl to already include /chat/completions
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

function buildBody(endpoint: Endpoint, request: StreamRequest): Record<string, unknown> {
  const messages = withSystemMessage(request.system, request.messages).map((m) => {
    const base: Record<string, unknown> = { role: m.role };
    if (m.role === "assistant") {
      base.content = m.content || null;
      if (m.toolCalls && m.toolCalls.length > 0) {
        base.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.input },
        }));
      }
    } else if (m.role === "tool") {
      if (m.toolResults && m.toolResults.length > 0) {
        return m.toolResults.map((r) => ({ role: "tool" as const, content: r.content, tool_call_id: r.toolCallId }));
      }
      return [{ role: "tool", content: m.content, tool_call_id: m.toolCallId }];
    } else {
      base.content = m.content;
    }
    return base;
  });

  const body: Record<string, unknown> = {
    model: request.model ?? endpoint.model,
    messages: messages.flat(),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (request.temperature != null) body.temperature = request.temperature;
  if (request.maxTokens != null) body.max_tokens = request.maxTokens;
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map(toOpenAITool);
  }
  if (request.toolChoice != null) body.tool_choice = request.toolChoice;
  return body;
}

function toOpenAITool(t: ToolDef): Record<string, unknown> {
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

function chunkUsage(chunk: OpenAIStreamChunk): Usage | null {
  const u = chunk.usage;
  if (!u) return null;
  const details = u.prompt_tokens_details;
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    cacheReadTokens: details?.cached_tokens ?? details?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: details?.cache_creation_input_tokens ?? 0,
  };
}

export class OpenAIClient implements LLMClient {
  readonly provider = "openai" as const;
  constructor(readonly endpoint: Endpoint) {}

  async stream(
    request: StreamRequest,
    callbacks: StreamCallbacks = {},
    signal?: AbortSignalLike,
  ): Promise<StreamResult> {
    try {
      return await this.doStream(request, callbacks, signal);
    } catch (err) {
      // Some providers only accept temperature: 1 (or reject explicit temperatures).
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
    const toolCalls: ToolCallInfo[] = [];
    // index -> accumulated tool call (keyed by delta index, or a derived id slot)
    const toolAcc: Record<number, { id: string; name: string; args: string }> = {};
    const seenMsgCalls = new Set<string>();
    let toolSlot = 0;
    let usage: Usage | null = null;
    let stopReason: string | undefined;

    const url = buildUrl(this.endpoint);
    const apiKey = resolveApiKey(this.endpoint.apiKey);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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
      // Some servers ignore stream:true — parse as a plain JSON completion.
      const json = (await response.json()) as OpenAIStreamChunk & { error?: { message?: string } };
      if (json.error?.message) throw new Error(json.error.message);
      const choice = json.choices?.[0];
      const msg = choice?.message;
      const content = choice?.delta?.content ?? msg?.content ?? "";
      const reasoning = choice?.delta?.reasoning_content ?? msg?.reasoning_content ?? "";
      if (reasoning) {
        ttftMs ??= performance.now() - started;
        reasoningText += reasoning;
        callbacks.onReasoningDelta?.(reasoning);
      }
      if (content) {
        ttftMs ??= performance.now() - started;
        text += content;
        callbacks.onFirstToken?.(ttftMs);
        callbacks.onDelta?.(content);
      } else if (reasoning) {
        ttftMs ??= performance.now() - started;
        callbacks.onFirstToken?.(ttftMs);
      }
      const msgToolCalls = msg?.tool_calls;
      if (msgToolCalls && msgToolCalls.length > 0) {
        for (const tc of msgToolCalls) {
          const call: ToolCallInfo = {
            id: tc.id ?? "",
            name: tc.function?.name ?? "",
            input: tc.function?.arguments ?? "",
          };
          ttftMs ??= performance.now() - started;
          callbacks.onFirstToken?.(ttftMs);
          callbacks.onToolCall?.(call);
          toolCalls.push(call);
        }
      }
      usage = chunkUsage(json) ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      stopReason = choice?.finish_reason ?? undefined;
      callbacks.onUsage?.(usage, stopReason);
      callbacks.onDone?.();
      return finalize();
    }

    // Merge a tool-call fragment (stream delta or full message call) into its slot.
    const feedToolCall = (tc: { id?: string; function?: { name?: string; arguments?: string } }, idx: number): void => {
      const acc = (toolAcc[idx] ??= { id: "", name: "", args: "" });
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = accumulateName(acc.name, tc.function.name);
      if (tc.function?.arguments) acc.args += tc.function.arguments;
      if (acc.id || acc.name || acc.args) {
        if (ttftMs === null) {
          ttftMs = performance.now() - started;
          callbacks.onFirstToken?.(ttftMs);
        }
        callbacks.onToolCall?.({ id: acc.id, name: acc.name, input: acc.args });
      }
    };

    try {
      for await (const ev of sseEvents(response.body, signal)) {
        throwIfAborted(signal);
        if (ev.data === "[DONE]") break;
        const chunk = tryParseJson<OpenAIStreamChunk>(ev.data);
        if (!chunk) continue;
        if (chunk.error?.message) throw new Error(chunk.error.message);

        const choice = chunk.choices?.[0];
        if (choice) {
          const delta = choice.delta ?? {};
          if (delta.content) {
            if (ttftMs === null) {
              ttftMs = performance.now() - started;
              callbacks.onFirstToken?.(ttftMs);
            }
            text += delta.content;
            callbacks.onDelta?.(delta.content);
          } else if (delta.reasoning_content) {
            if (ttftMs === null) {
              ttftMs = performance.now() - started;
              callbacks.onFirstToken?.(ttftMs);
            }
            reasoningText += delta.reasoning_content;
            callbacks.onReasoningDelta?.(delta.reasoning_content);
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) feedToolCall(tc, tc.index ?? 0);
          }
          if (choice.message?.tool_calls) {
            for (const tc of choice.message.tool_calls) {
              if (tc.id && seenMsgCalls.has(tc.id)) continue;
              if (tc.id) seenMsgCalls.add(tc.id);
              const idx = slotFromId(tc.id) ?? toolSlot++;
              feedToolCall(tc, idx);
            }
          }
          if (choice.finish_reason) stopReason = choice.finish_reason;
        }
        const u = chunkUsage(chunk);
        if (u) {
          usage = u;
          callbacks.onUsage?.(u, stopReason);
        }
      }
    } catch (err) {
      if (signal?.aborted) throw new AbortError();
      throw err;
    }

    for (const key of Object.keys(toolAcc).map(Number).sort((a, b) => a - b)) {
      const acc = toolAcc[key];
      if (acc) toolCalls.push({ id: acc.id, name: acc.name, input: acc.args });
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

