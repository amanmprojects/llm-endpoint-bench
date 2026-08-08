// End-to-end test of the client + benchmark pipeline against the mock server.
// Usage: bun scripts/test-pipeline.ts
import { ConfigStore } from "../src/core/config.ts";
import { runBenchmarks } from "../src/bench/runner.ts";
import { createClient } from "../src/core/clients/factory.ts";
import type { ChatMsg } from "../src/core/clients/client.ts";

const BASE = "http://localhost:8765";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main(): Promise<void> {
  const store = new ConfigStore();
  store.endpoints = [
    {
      id: "mock-openai",
      name: "mock-openai",
      provider: "openai",
      baseUrl: `${BASE}/v1`,
      apiKey: "sk-mock",
      model: "mock-model",
      pricing: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
    },
    {
      id: "mock-anthropic",
      name: "mock-anthropic",
      provider: "anthropic",
      baseUrl: `${BASE}/v1`,
      apiKey: "sk-ant-mock",
      model: "mock-model",
      pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
  ];
  store.save();

  // --- Direct client test: OpenAI ---
  const oai = createClient(store.endpoints[0]!);
  const deltas: string[] = [];
  let ttft: number | null = null;
  const r1 = await oai.stream(
    { messages: [{ role: "user", content: "hi" }], maxTokens: 64 },
    {
      onFirstToken: (ms) => (ttft = ms),
      onDelta: (d) => deltas.push(d),
    },
  );
  assert(ttft != null, "openai ttft should be measured");
  assert(deltas.length > 0, "openai should stream deltas");
  assert(r1.usage.outputTokens > 0, "openai usage should report output tokens");
  assert(r1.ttftMs != null && r1.ttftMs >= 100, `openai ttft ~120ms, got ${r1.ttftMs}`);
  console.log("✓ OpenAI client streams, TTFT measured:", r1.ttftMs?.toFixed(0), "ms");

  // --- Direct client test: Anthropic ---
  const ant = createClient(store.endpoints[1]!);
  const antDeltas: string[] = [];
  const r2 = await ant.stream(
    { messages: [{ role: "user", content: "hi" }], maxTokens: 64 },
    { onDelta: (d) => antDeltas.push(d) },
  );
  assert(antDeltas.length > 0, "anthropic should stream deltas");
  assert(r2.usage.inputTokens > 0, "anthropic usage should report input tokens");
  console.log("✓ Anthropic client streams, TTFT:", r2.ttftMs?.toFixed(0), "ms");

  // --- Tool call flow: OpenAI ---
  const toolDeltas: string[] = [];
  let toolCalls: Array<{ name: string }> = [];
  const r3 = await oai.stream(
    {
      messages: [{ role: "user", content: "compute 17*23" }],
      tools: [{ name: "calculator", description: "calc", parameters: { type: "object", properties: { expression: { type: "string" } } } }],
      toolChoice: { type: "function", function: { name: "calculator" } },
      maxTokens: 128,
    },
    { onDelta: (d) => toolDeltas.push(d), onToolCall: (tc) => toolCalls.push(tc) },
  );
  assert(r3.toolCalls.length === 1, `openai should return 1 tool call, got ${r3.toolCalls.length}`);
  assert(r3.toolCalls[0]?.name === "calculator", "tool call should be calculator");
  assert(!!r3.toolCalls[0]?.input.includes("17*23"), "tool args should accumulate");
  console.log("✓ OpenAI tool call flow:", r3.toolCalls[0]?.name, r3.toolCalls[0]?.input);

  // --- Tool call flow: Anthropic ---
  const r4 = await ant.stream(
    {
      messages: [{ role: "user", content: "compute 17*23" }],
      tools: [{ name: "calculator", description: "calc", parameters: { type: "object", properties: { expression: { type: "string" } } } }],
      toolChoice: { type: "tool", name: "calculator" },
      maxTokens: 128,
    },
  );
  assert(r4.toolCalls.length === 1, `anthropic should return 1 tool call, got ${r4.toolCalls.length}`);
  console.log("✓ Anthropic tool call flow:", r4.toolCalls[0]?.name, r4.toolCalls[0]?.input);

  // --- Multi-turn tool session (TTFT after tool call) ---
  const turn2 = await oai.stream({
    messages: [
      { role: "user", content: "compute 17*23" },
      { role: "assistant", content: "", toolCalls: r3.toolCalls },
      { role: "tool", toolResults: [{ toolCallId: r3.toolCalls[0]!.id, content: "391" }] },
    ] as ChatMsg[],
    maxTokens: 64,
  });
  assert(turn2.ttftMs != null, "turn 2 ttft measured");
  console.log("✓ Tool result follow-up TTFT:", turn2.ttftMs?.toFixed(0), "ms");

  // --- Full benchmark suite (both providers) ---
  for (const ep of store.endpoints) {
    const results = await runBenchmarks({
      endpoint: ep,
      kinds: ["ttft", "throughput", "cache", "toolcall"],
      onProgress: (p) => {
        process.stderr.write(`\r  ${ep.name}: ${p.testIndex}/${p.testCount} ${p.status}`);
      },
    });
    process.stderr.write("\n");
    for (const r of results) {
      assert(r.status === "ok", `${ep.name} ${r.kind} should be ok: ${r.error ?? ""}`);
      const t0 = r.turns[0];
      assert(t0?.ttftMs != null, `${ep.name} ${r.kind} should have ttft`);
    }
    const ttft = results[0]!;
    const cache = results[2]!;
    const tool = results[3]!;
    console.log(`✓ ${ep.name}: TTFT ${ttft.turns[0]?.ttftMs?.toFixed(0)}ms · throughput ${ttft.turns[0]?.tokensPerSec?.toFixed(1)} tok/s · cache ${cache.turns[1]?.cacheReadTokens ?? 0}R/${cache.turns[0]?.cacheWriteTokens ?? 0}W · tool-turn TTFT ${tool.turns[1]?.ttftMs?.toFixed(0)}ms · cost $${results.reduce((s, r) => s + r.totalCost, 0).toFixed(4)}`);
  }

  console.log("\n✅ ALL PIPELINE TESTS PASSED");
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err);
  process.exit(1);
});
