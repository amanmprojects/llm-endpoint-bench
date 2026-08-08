// Orchestrates a suite of benchmark tests against one endpoint.
import type { BenchCallbacks, TestContext, StreamSnapshot } from "./tests.ts";
import { DEFAULT_PROMPTS, runTest } from "./tests.ts";
import type { TestKind, TestResult, Endpoint } from "../core/types.ts";
import type { LLMClient } from "../core/clients/client.ts";
import type { AbortSignalLike } from "../core/clients/abort.ts";
import { createClient } from "../core/clients/factory.ts";

export interface BenchProgress {
  testIndex: number;
  testCount: number;
  currentKind: TestKind | null;
  status: string;
  live: StreamSnapshot | null;
  done: TestResult[];
  currentTest?: TestResult;
}

export interface RunOptions {
  endpoint: Endpoint;
  kinds: TestKind[];
  iterations?: number;
  onProgress?: (p: BenchProgress) => void;
  signal?: AbortSignalLike;
  prompts?: Partial<typeof DEFAULT_PROMPTS>;
}

export async function runBenchmarks(opts: RunOptions): Promise<TestResult[]> {
  const client = createClient(opts.endpoint);
  const results: TestResult[] = [];
  const kinds = opts.kinds ?? ["ttft"];
  const iterations = Math.max(1, opts.iterations ?? 1);
  const prompts = { ...DEFAULT_PROMPTS, ...(opts.prompts ?? {}) };

  const progress: BenchProgress = {
    testIndex: 0,
    testCount: kinds.length * iterations,
    currentKind: null,
    status: "starting",
    live: null,
    done: [],
  };

  const ctx: TestContext = {
    endpoint: opts.endpoint,
    client,
    prompts,
    signal: opts.signal,
    cbs: {
      onStatus: (msg) => {
        progress.status = msg;
        opts.onProgress?.({ ...progress });
      },
      onStream: (snap) => {
        progress.live = snap;
        opts.onProgress?.({ ...progress });
      },
    },
  };

  for (const kind of kinds) {
    for (let it = 0; it < iterations; it++) {
      if (opts.signal?.aborted) return results;
      progress.testIndex++;
      progress.currentKind = kind;
      const label = iterations > 1 ? `${kind} (iteration ${it + 1}/${iterations})` : kind;
      ctx.cbs.onStatus(`running ${label}…`);
      try {
        const result = await runTest(kind, ctx);
        results.push(result);
        progress.done = [...results];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          id: crypto.randomUUID(),
          kind,
          name: kind,
          status: "error",
          error: msg,
          startedAt: performance.now(),
          durationMs: 0,
          turns: [],
          totalCost: 0,
          totalUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        });
        progress.done = [...results];
      }
      progress.currentKind = null;
      progress.live = null;
      opts.onProgress?.({ ...progress });
    }
  }
  return results;
}
