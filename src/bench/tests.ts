// Benchmark test implementations: TTFT, throughput, caching, tool-call latency.
import type { CacheStats, Endpoint, TestKind, TestResult, TurnMetrics, Usage } from "../core/types.ts";
import { computeCost } from "../core/pricing.ts";
import { estimateTokens } from "../core/format.ts";
import { EMPTY_USAGE } from "../core/types.ts";
import type { AbortSignalLike } from "../core/clients/abort.ts";
import { throwIfAborted } from "../core/clients/abort.ts";
import type { ChatMsg, LLMClient, StreamRequest, StreamResult, ToolDef } from "../core/clients/client.ts";
import { CALCULATOR_TOOL, TIME_TOOL, executeTool } from "../core/clients/client.ts";

export interface TestPrompts {
  ttft: string;
  throughput: string;
  /** Base text repeated to build a large prompt for cache tests. */
  cacheBase: string;
  toolcall: string;
}

export const DEFAULT_PROMPTS: TestPrompts = {
  ttft: "Reply with a short haiku about the ocean.",
  throughput:
    "Write a detailed, well-structured essay about the history of computing from the 1940s to today. " +
    "Cover hardware, software, programming languages, the internet, AI, and what you predict for the next decade. " +
    "Write as much as you can — several long paragraphs with headings.",
  cacheBase:
    "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. " +
    "How vexingly quick daft zebras jump. Sphinx of black quartz, judge my vow. " +
    "The five boxing wizards jump quickly. Waltz, bad nymph, for quick jigs vex. " +
    "Glib jocks quiz nymphs to vex dwarf. Quick zephyrs blow, vexing daft Jim. " +
    "Cozy lummox gives smart squid who asks for job pen. ",
  toolcall: "Use the calculator tool to compute 17 * 23, then reply with just the numeric result and nothing else.",
};

export interface StreamSnapshot {
  phase: "connecting" | "streaming" | "done";
  elapsedMs: number;
  ttftMs: number | null;
  headersMs: number | null;
  chars: number;
  estTokens: number;
  /** Rolling tokens/sec estimate based on chars. */
  tokPerSec: number | null;
  usage: Usage | null;
  text: string;
}

export interface BenchCallbacks {
  onStatus(msg: string): void;
  /** Live snapshot of the in-flight request (throttled by caller). */
  onStream?(snap: StreamSnapshot): void;
}

export interface TestContext {
  endpoint: Endpoint;
  client: LLMClient;
  prompts: TestPrompts;
  cbs: BenchCallbacks;
  signal?: AbortSignalLike;
}

const CACHE_TARGET_TOKENS = 3000;

// ---------------------------------------------------------------------------
// Single request helper
// ---------------------------------------------------------------------------

async function runRequest(
  ctx: TestContext,
  request: StreamRequest,
  opts: { label: string; throttleMs?: number },
): Promise<TurnMetrics & { text: string }> {
  const { client, cbs, signal } = ctx;
  const started = performance.now();
  let ttftMs: number | null = null;
  let headersMs: number | null = null;
  let text = "";
  let reasoningText = "";
  let usage: Usage | null = null;
  let stopReason: string | undefined;
  const toolCalls: { id: string; name: string; input: string }[] = [];

  let lastEmit = 0;
  const emit = (phase: StreamSnapshot["phase"], force = false) => {
    if (!cbs.onStream) return;
    const now = performance.now();
    if (!force && now - lastEmit < (opts.throttleMs ?? 60)) return;
    lastEmit = now;
    const elapsedMs = now - started;
    const estTokens = estimateTokens(text.length);
    const streamTime = ttftMs != null ? elapsedMs - ttftMs : 0;
    cbs.onStream({
      phase,
      elapsedMs,
      ttftMs,
      headersMs,
      chars: text.length,
      estTokens,
      tokPerSec: streamTime > 100 ? estTokens / (streamTime / 1000) : null,
      usage,
      text,
    });
  };

  const result: StreamResult = await client.stream(
    request,
    {
      onHeaders: (ms) => {
        headersMs = ms;
        emit("connecting");
      },
      onFirstToken: (ms) => {
        ttftMs = ms;
        emit("streaming", true);
      },
      onDelta: (d) => {
        text += d;
        emit("streaming");
      },
      onReasoningDelta: (d) => {
        reasoningText += d;
        emit("streaming");
      },
      onToolCall: (tc) => {
        if (tc.id) {
          const idx = toolCalls.findIndex((t) => t.id === tc.id);
          if (idx >= 0) toolCalls[idx] = tc;
          else toolCalls.push(tc);
        } else {
          // Partial call without an id yet — update the last same-name entry.
          const idx = toolCalls.findIndex((t) => t.name === tc.name && !t.id);
          if (idx >= 0) toolCalls[idx] = tc;
          else toolCalls.push(tc);
        }
        emit("streaming");
      },
      onUsage: (u, sr) => {
        usage = u;
        if (sr) stopReason = sr;
        emit("streaming");
      },
    },
    signal,
  );

  // Merge any tool calls returned by the client that we didn't see via callbacks.
  for (const tc of result.toolCalls) {
    if (!toolCalls.some((t) => t.id === tc.id && t.name === tc.name)) toolCalls.push(tc);
  }
  usage = result.usage ?? usage ?? EMPTY_USAGE;
  stopReason = result.stopReason ?? stopReason;
  ttftMs = result.ttftMs ?? ttftMs;
  headersMs = result.headersMs ?? headersMs;
  text = result.text || text;

  const end = performance.now();
  const durationMs = end - started;
  const streamTime = ttftMs != null ? durationMs - ttftMs : durationMs;
  const tokensPerSec = result.usage.outputTokens > 0 && streamTime > 0 ? result.usage.outputTokens / (streamTime / 1000) : null;

  const turn: TurnMetrics = {
    label: opts.label,
    ttftMs,
    headersMs,
    durationMs,
    outputTokens: usage.outputTokens,
    inputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    tokensPerSec,
    cost: computeCost(ctx.endpoint.pricing, usage),
    charCount: text.length,
    reasoningTokens: reasoningText.length > 0 ? estimateTokens(reasoningText.length) : undefined,
    toolCalls: toolCalls.map((t) => ({ ...t })),
    stopReason,
  };

  emit("done", true);
  return { ...turn, text };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export async function runTTFT(ctx: TestContext): Promise<TestResult> {
  const id = crypto.randomUUID();
  const started = performance.now();
  ctx.cbs.onStatus("TTFT test: streaming single completion…");
  throwIfAborted(ctx.signal);

  const turn = await runRequest(
    ctx,
    {
      messages: [{ role: "user", content: ctx.prompts.ttft }],
      maxTokens: 256,
      temperature: ctx.endpoint.temperature ?? undefined,
    },
    { label: "single request" },
  );

  return {
    id,
    kind: "ttft",
    name: "Time to First Token",
    status: "ok",
    startedAt: started,
    durationMs: turn.durationMs,
    turns: [turn],
    totalCost: turn.cost,
    totalUsage: {
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      cacheReadTokens: turn.cacheReadTokens,
      cacheWriteTokens: turn.cacheWriteTokens,
    },
  };
}

export async function runThroughput(ctx: TestContext): Promise<TestResult> {
  const id = crypto.randomUUID();
  const started = performance.now();
  ctx.cbs.onStatus("Throughput test: streaming long completion…");
  throwIfAborted(ctx.signal);

  const turn = await runRequest(
    ctx,
    {
      messages: [{ role: "user", content: ctx.prompts.throughput }],
      maxTokens: 2048,
      temperature: ctx.endpoint.temperature ?? undefined,
    },
    { label: "long generation" },
  );

  return {
    id,
    kind: "throughput",
    name: "Output Throughput",
    status: "ok",
    startedAt: started,
    durationMs: turn.durationMs,
    turns: [turn],
    totalCost: turn.cost,
    totalUsage: {
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      cacheReadTokens: turn.cacheReadTokens,
      cacheWriteTokens: turn.cacheWriteTokens,
    },
  };
}

export async function runCache(ctx: TestContext): Promise<TestResult> {
  const id = crypto.randomUUID();
  const started = performance.now();
  throwIfAborted(ctx.signal);

  // Build a system prompt big enough to be cacheable (>= ~3000 tokens).
  let system = "";
  let reps = 1;
  while (estimateTokens(system.length + ctx.prompts.cacheBase.length * (reps + 1)) < CACHE_TARGET_TOKENS) reps++;
  for (let i = 0; i < reps; i++) system += ctx.prompts.cacheBase;

  const request: StreamRequest = {
    system,
    messages: [{ role: "user", content: "Summarize the above text in one sentence." }],
    maxTokens: 64,
    temperature: ctx.endpoint.temperature ?? undefined,
    useCache: true,
  };

  ctx.cbs.onStatus(`Cache test: request 1/2 (cold, ${estimateTokens(system.length)} est. prompt tokens)…`);
  const cold = await runRequest(ctx, request, { label: "cold (no cache)" });

  ctx.cbs.onStatus("Cache test: request 2/2 (warm, expecting cache read)…");
  const warm = await runRequest(ctx, request, { label: "warm (cache read)" });

  const cacheWrite = warm.cacheWriteTokens || cold.cacheWriteTokens;
  const cacheRead = warm.cacheReadTokens;
  // inputTokens already includes the cached portion on OpenAI/Anthropic; be robust
  // to providers that report uncached-only by never under-counting the prompt.
  const totalInput = Math.max(warm.inputTokens, warm.cacheReadTokens + warm.cacheWriteTokens);
  const cacheSupported = cacheWrite > 0 || cacheRead > 0;
  const cacheReadPct = totalInput > 0 ? cacheRead / totalInput : 0;

  const cache: CacheStats = {
    requests: 2,
    cacheWriteTokens: cacheWrite,
    cacheReadTokens: cacheRead,
    totalInputTokens: totalInput,
    totalOutputTokens: warm.outputTokens,
    cacheReadPct,
    ttftColdMs: cold.ttftMs,
    ttftWarmMs: warm.ttftMs,
    costCold: cold.cost,
    costWarm: warm.cost,
    costSavings: cold.cost - warm.cost,
    cacheSupported,
  };

  const totalUsage: Usage = {
    inputTokens: cold.inputTokens + warm.inputTokens,
    outputTokens: cold.outputTokens + warm.outputTokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };

  return {
    id,
    kind: "cache",
    name: "Prompt Caching",
    status: "ok",
    startedAt: started,
    durationMs: cold.durationMs + warm.durationMs,
    turns: [cold, warm],
    totalCost: cold.cost + warm.cost,
    totalUsage,
    cache,
  };
}

export async function runToolCall(ctx: TestContext): Promise<TestResult> {
  const id = crypto.randomUUID();
  const started = performance.now();
  const isAnthropic = ctx.endpoint.provider === "anthropic";
  throwIfAborted(ctx.signal);

  const tools: ToolDef[] = [CALCULATOR_TOOL, TIME_TOOL];
  const toolChoice = isAnthropic
    ? { type: "tool", name: "calculator" as const }
    : { type: "function" as const, function: { name: "calculator" } };

  let usedLooseChoice = false;
  ctx.cbs.onStatus("Tool-call test: turn 1 — model calls tool…");
  const baseReq: StreamRequest = {
    messages: [{ role: "user", content: ctx.prompts.toolcall }],
    tools,
    toolChoice,
    maxTokens: 512,
    temperature: ctx.endpoint.temperature ?? undefined,
  };
  let turn1: TurnMetrics & { text: string };
  try {
    turn1 = await runRequest(ctx, baseReq, { label: "turn 1 (tool call)" });
  } catch (err) {
    // Some thinking-mode models reject forced tool_choice — retry without it.
    if (err instanceof Error && /tool[_ ]choice|thinking mode/i.test(err.message)) {
      ctx.cbs.onStatus("Tool-call test: forced tool_choice rejected — retrying without it…");
      const { toolChoice: _tc, ...looseReq } = baseReq;
      usedLooseChoice = true;
      turn1 = await runRequest(ctx, looseReq, { label: "turn 1 (tool call, auto)" });
    } else {
      throw err;
    }
  }

  const turns = [turn1];
  const noteParts: string[] = [];
  if (usedLooseChoice) noteParts.push("forced tool_choice unsupported — used auto tool selection");

  if (turn1.toolCalls.length === 0) {
    noteParts.push("model did not call the tool (forced tool_choice may be unsupported)");
    const result: TestResult = {
      id,
      kind: "toolcall",
      name: "Tool-Call Session TTFT",
      status: "ok",
      startedAt: started,
      durationMs: turn1.durationMs,
      turns,
      totalCost: turn1.cost,
      totalUsage: {
        inputTokens: turn1.inputTokens,
        outputTokens: turn1.outputTokens,
        cacheReadTokens: turn1.cacheReadTokens,
        cacheWriteTokens: turn1.cacheWriteTokens,
      },
    };
    turns[0]!.note = noteParts.join("; ");
    return result;
  }

  // Execute tools, then feed results back in one merged tool message.
  ctx.cbs.onStatus(`Tool-call test: executing ${turn1.toolCalls.map((t) => t.name).join(", ")}…`);
  const toolMsg: ChatMsg = {
    role: "tool",
    content: "",
    toolResults: turn1.toolCalls.map((tc) => ({
      toolCallId: tc.id,
      content: executeTool(tc.name, parseArgs(tc.input)),
    })),
  };

  const messages: ChatMsg[] = [
    { role: "user", content: ctx.prompts.toolcall },
    { role: "assistant", content: turn1.text, toolCalls: turn1.toolCalls },
    toolMsg,
  ];

  ctx.cbs.onStatus("Tool-call test: turn 2 — TTFT after tool result…");
  const turn2 = await runRequest(
    ctx,
    { messages, maxTokens: 512, temperature: ctx.endpoint.temperature ?? undefined },
    { label: "turn 2 (after tool call)" },
  );
  turns.push(turn2);

  if (turn2.toolCalls.length > 0) {
    noteParts.push("model called another tool; deeper agent loops not measured in this test");
  }

  const totalUsage: Usage = {
    inputTokens: turn1.inputTokens + turn2.inputTokens,
    outputTokens: turn1.outputTokens + turn2.outputTokens,
    cacheReadTokens: turn1.cacheReadTokens + turn2.cacheReadTokens,
    cacheWriteTokens: turn1.cacheWriteTokens + turn2.cacheWriteTokens,
  };

  const result: TestResult = {
    id,
    kind: "toolcall",
    name: "Tool-Call Session TTFT",
    status: "ok",
    startedAt: started,
    durationMs: turn1.durationMs + turn2.durationMs,
    turns,
    totalCost: turn1.cost + turn2.cost,
    totalUsage,
  };
  if (noteParts.length > 0) turns[turns.length - 1]!.note = noteParts.join("; ");
  return result;
}

export function runTest(kind: TestKind, ctx: TestContext): Promise<TestResult> {
  switch (kind) {
    case "ttft":
      return runTTFT(ctx);
    case "throughput":
      return runThroughput(ctx);
    case "cache":
      return runCache(ctx);
    case "toolcall":
      return runToolCall(ctx);
    default:
      throw new Error(`unknown test kind: ${String(kind)}`);
  }
}

function parseArgs(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
