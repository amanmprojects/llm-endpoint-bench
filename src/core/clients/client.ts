// Client abstraction shared by OpenAI-compatible and Anthropic endpoints.
import type { Endpoint, Usage, ToolCallInfo } from "../types.ts";
import type { AbortSignalLike } from "./abort.ts";

export interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  /** Plain text content. */
  content: string;
  /** For assistant messages that called tools. */
  toolCalls?: ToolCallInfo[];
  /** For tool role messages: single tool result. */
  toolCallId?: string;
  /** For tool role messages: multiple tool results (merged by the client as the provider requires). */
  toolResults?: Array<{ toolCallId: string; content: string }>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StreamRequest {
  messages: ChatMsg[];
  /** System prompt (Anthropic-style). For OpenAI it is merged as the first system message. */
  system?: string;
  tools?: ToolDef[];
  toolChoice?: unknown;
  maxTokens?: number;
  temperature?: number;
  /** Anthropic: add cache_control to system + last user block. */
  useCache?: boolean;
  /** Optional model override (defaults to endpoint.model). */
  model?: string;
}

export interface StreamCallbacks {
  /** Response headers received: elapsed ms since request start. */
  onHeaders?: (headersMs: number) => void;
  /** First output arrived (text delta or tool-use block start): elapsed ms. */
  onFirstToken?: (ttftMs: number) => void;
  /** Content text delta (does NOT include reasoning/thinking tokens). */
  onDelta?: (text: string) => void;
  /** Reasoning/thinking token delta (OpenAI reasoning_content, Anthropic thinking_delta). */
  onReasoningDelta?: (text: string) => void;
  /** A tool-use block started (Anthropic) or a tool call delta arrived (OpenAI). */
  onToolCall?: (call: ToolCallInfo) => void;
  /** Final usage + stop reason. May be called more than once; last wins. */
  onUsage?: (usage: Usage, stopReason?: string) => void;
  /** Stream finished cleanly. */
  onDone?: () => void;
}

export interface StreamResult {
  usage: Usage;
  stopReason?: string;
  /** Content text (excludes reasoning). */
  text: string;
  /** Reasoning/thinking text (OpenAI reasoning_content, Anthropic thinking blocks). */
  reasoningText: string;
  toolCalls: ToolCallInfo[];
  /** ms from request start to first output token. */
  ttftMs: number | null;
  headersMs: number | null;
}

export interface LLMClient {
  readonly provider: "openai" | "anthropic";
  readonly endpoint: Endpoint;
  /** Stream a chat completion. Resolves when the stream completes or errors. */
  stream(request: StreamRequest, callbacks?: StreamCallbacks, signal?: AbortSignalLike): Promise<StreamResult>;
}

export const CALCULATOR_TOOL: ToolDef = {
  name: "calculator",
  description: "Evaluate a simple arithmetic expression such as '17*23' or '(12+8)/5'. Supports + - * / and parentheses.",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "The arithmetic expression to evaluate." },
    },
    required: ["expression"],
  },
};

export const TIME_TOOL: ToolDef = {
  name: "get_current_time",
  description: "Get the current date and time in ISO 8601 format.",
  parameters: {
    type: "object",
    properties: {},
  },
};

/** Execute the built-in demo tool set. Returns text result. */
export function executeTool(name: string, input: unknown): string {
  switch (name) {
    case "calculator": {
      const expr = typeof input === "object" && input !== null && "expression" in input ? String((input as { expression: unknown }).expression) : String(input);
      return `${safeEval(expr)}`;
    }
    case "get_current_time":
      return new Date().toISOString();
    default:
      return "OK";
  }
}

function safeEval(exprRaw: string): number {
  const expr = exprRaw.replace(/[^0-9+\-*/().\s]/g, "").trim();
  if (!expr) return NaN;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(`"use strict"; return (${expr});`);
  const v = fn();
  if (typeof v !== "number" || !Number.isFinite(v)) return NaN;
  return Math.round(v * 1e6) / 1e6;
}

/** Merge system message into an OpenAI-style message array. */
export function withSystemMessage(system: string | undefined, messages: ChatMsg[]): ChatMsg[] {
  if (!system || !system.trim()) return messages;
  if (messages.length > 0 && messages[0]?.role === "system") {
    const [first, ...rest] = messages;
    return [{ ...first, content: first?.content ? `${first.content}\n\n${system}` : system }, ...rest];
  }
  return [{ role: "system", content: system }, ...messages];
}
