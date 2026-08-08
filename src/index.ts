#!/usr/bin/env bun
// llm-bench — LLM endpoint benchmark TUI.
//
// Usage:
//   bun src/index.ts                         # interactive TUI
//   bun src/index.ts --headless --endpoint <id> --tests ttft,throughput,cache,toolcall
//   bun src/index.ts --list-endpoints
import { ConfigStore, maskKey } from "./core/config.ts";
import { runBenchmarks } from "./bench/runner.ts";
import type { TestKind } from "./core/types.ts";
import { fmtCost, fmtMs, fmtNum } from "./core/format.ts";
import { DEFAULT_PROMPTS } from "./bench/tests.ts";

const VERSION = "0.1.0";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = new ConfigStore();
  config.load();

  if (args["list-endpoints"]) {
    console.log(JSON.stringify({ version: VERSION, endpoints: config.endpoints.map((e) => ({ ...e, apiKey: maskKey(e.apiKey) })) }, null, 2));
    return;
  }

  if (args["headless"]) {
    await headless(config, args);
    return;
  }

  if (args["help"]) {
    printHelp();
    return;
  }

  const { App } = await import("./ui/app.ts");
  const app = new App();
  await app.start();
}

async function headless(config: ConfigStore, args: Record<string, string | boolean>): Promise<void> {
  const endpoints = config.endpoints;
  if (endpoints.length === 0) {
    console.error("No endpoints configured. Add one via the TUI, or edit ~/.llm-bench/endpoints.json");
    process.exit(1);
  }
  const idArg = typeof args["endpoint"] === "string" ? args["endpoint"] : null;
  const endpoint = endpoints.find((e) => e.id === idArg || e.name === idArg) ?? endpoints[0]!;
  const testsArg = typeof args["tests"] === "string" ? args["tests"] : "ttft";
  const kinds = testsArg.split(",").map((s) => s.trim()).filter(Boolean) as TestKind[];
  const iterations = typeof args["iterations"] === "string" ? Math.max(1, parseInt(args["iterations"], 10) || 1) : 1;
  const prompt = typeof args["prompt"] === "string" ? args["prompt"] : undefined;

  console.error(`benchmarking ${endpoint.name} (${endpoint.model}) — ${kinds.join(", ")} × ${iterations}`);

  const results = await runBenchmarks({
    endpoint,
    kinds,
    iterations,
    prompts: prompt ? { ttft: prompt } : undefined,
    onProgress: (p) => {
      if (p.live && p.live.ttftMs != null) {
        process.stderr.write(`\r  ${p.status} — TTFT ${fmtMs(p.live.ttftMs)} · ${fmtNum(p.live.tokPerSec, 1)} tok/s · ${fmtMs(p.live.elapsedMs)}`);
      } else {
        process.stderr.write(`\r  ${p.status}…`);
      }
    },
  });
  process.stderr.write("\n");

  for (const r of results) {
    if (r.status === "error") {
      console.error(`✖ ${r.name}: ${r.error}`);
    } else {
      const t0 = r.turns[0];
      console.error(`✓ ${r.name}: TTFT ${fmtMs(t0?.ttftMs)} · ${fmtNum(t0?.tokensPerSec, 1)} tok/s · ${fmtCost(r.totalCost)}`);
    }
  }

  // Persist the run for later browsing in the TUI.
  if (results.length > 0) {
    try {
      const { HistoryStore } = await import("./core/history.ts");
      const history = new HistoryStore();
      history.load();
      history.add({
        endpointId: endpoint.id,
        endpointLabel: endpoint.name,
        provider: endpoint.provider,
        model: endpoint.model,
        baseUrl: endpoint.baseUrl,
        kinds,
        iterations,
        results,
        totalCost: results.reduce((s, r) => s + r.totalCost, 0),
      });
    } catch (err) {
      console.error("failed to save history:", err);
    }
  }

  console.log(JSON.stringify({ version: VERSION, endpoint: endpoint.name, model: endpoint.model, iterations, results }, null, 2));
}

function printHelp(): void {
  console.log(`llm-bench v${VERSION} — LLM endpoint benchmark

TUI:
  bun src/index.ts

Headless:
  bun src/index.ts --headless --endpoint <id|name> --tests ttft,throughput,cache,toolcall [--iterations 3] [--prompt "…"]

Other:
  bun src/index.ts --list-endpoints
  bun src/index.ts --help
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
