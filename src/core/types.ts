// Core domain types for the LLM endpoint benchmark tool.

export type ProviderType = "openai" | "anthropic";

/** Pricing in USD per 1,000,000 tokens. */
export interface Pricing {
  /** Price per 1M input (prompt) tokens, not served from cache. */
  input: number;
  /** Price per 1M output (completion) tokens. */
  output: number;
  /** Price per 1M tokens read from prompt cache. */
  cacheRead: number;
  /** Price per 1M tokens written to prompt cache. */
  cacheWrite: number;
}

export interface Endpoint {
  id: string;
  name: string;
  provider: ProviderType;
  /** e.g. https://api.openai.com/v1 or https://api.anthropic.com/v1 */
  baseUrl: string;
  /** Literal key or "env:VAR_NAME" to read from the environment. */
  apiKey: string;
  model: string;
  pricing: Pricing;
  /** Sampling temperature; null/undefined = don't send (provider default). */
  temperature?: number | null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  /** JSON string of the arguments. */
  input: string;
}

export interface TurnMetrics {
  label: string;
  /** Time from request start to first token, ms. */
  ttftMs: number | null;
  /** Time from request start to response headers, ms. */
  headersMs: number | null;
  /** Total request duration, ms. */
  durationMs: number;
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Steady state output tokens/sec (excluding TTFT). */
  tokensPerSec: number | null;
  /** Cost in USD for this turn. */
  cost: number;
  /** Characters received (content text). */
  charCount: number;
  /** Reasoning/thinking characters received (estimated tokens). */
  reasoningTokens?: number;
  toolCalls: ToolCallInfo[];
  stopReason?: string;
  note?: string;
}

export type TestKind = "ttft" | "throughput" | "cache" | "toolcall";

export interface CacheStats {
  /** Number of identical requests made (cold + warm). */
  requests: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** cacheRead / totalInput, 0..1 */
  cacheReadPct: number;
  ttftColdMs: number | null;
  ttftWarmMs: number | null;
  costCold: number;
  costWarm: number;
  /** costCold - costWarm (positive = savings from caching) */
  costSavings: number;
  /** true if the provider reported any cache metrics */
  cacheSupported: boolean;
}

export interface TestResult {
  id: string;
  kind: TestKind;
  name: string;
  status: "ok" | "error";
  error?: string;
  startedAt: number;
  durationMs: number;
  turns: TurnMetrics[];
  totalCost: number;
  totalUsage: Usage;
  cache?: CacheStats;
}

export interface BenchRunSummary {
  endpoint: Endpoint;
  results: TestResult[];
  startedAt: number;
  finishedAt: number;
  totalCost: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
