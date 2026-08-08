// UI smoke test using the OpenTUI test renderer (no real terminal needed).
// Usage: bun scripts/test-ui.ts   (requires the mock server on :8765)
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app.ts";
import { ConfigStore } from "../src/core/config.ts";
import type { Endpoint } from "../src/core/types.ts";

const BASE = "http://localhost:8765";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const endpoints: Endpoint[] = [
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

async function waitFor(setup: Awaited<ReturnType<typeof createTestRenderer>>, pred: (f: string) => boolean, timeoutMs = 6000): Promise<string> {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    last = setup.captureCharFrame();
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`waitFor timed out. Last frame:\n${last.slice(0, 3000)}`);
}

async function main(): Promise<void> {
  const setup = await createTestRenderer({ width: 130, height: 38, consoleMode: "disabled" });
  try {
    const store = new ConfigStore();
    store.endpoints = endpoints;
    store.save();

    const app = new App();
    app.config.endpoints = endpoints;
    await app.start(setup.renderer);

    // --- Dashboard ---
    let frame = await waitFor(setup, (f) => f.includes("llm-bench"));
    assert(frame.includes("mock-openai"), "dashboard lists mock-openai");
    assert(frame.includes("Endpoint details"), "dashboard shows details panel");
    assert(frame.includes("actions"), "dashboard hint bar");
    console.log("✓ dashboard renders with endpoints + details");

    // --- Chat screen ---
    setup.mockInput.pressKey("c");
    frame = await waitFor(setup, (f) => f.includes("Interactive chat"));
    assert(frame.includes("Live metrics"), "chat shows live metrics panel");
    assert(frame.includes("Session totals"), "chat shows session totals");
    assert(frame.includes("Turn TTFT"), "chat shows turn TTFT panel");
    console.log("✓ chat screen layout renders (metrics/totals/turns panels)");

    // --- Send a message and stream ---
    await setup.mockInput.typeText("hello there");
    setup.mockInput.pressEnter();

    frame = await waitFor(setup, (f) => f.includes("assistant") && /✓ assistant/.test(f), 15000);
    assert(frame.includes("Turn TTFT"), "turn TTFT panel shows an assistant turn");
    console.log("✓ chat streams a message and records turn TTFT");

    // --- Esc back to dashboard, then run benchmarks ---
    // Wait for the agent loop to settle first (ready / stopped / aborted)
    await waitFor(setup, (f) => /ready|stopped after max tool rounds|aborted/.test(f), 20000);
    setup.mockInput.pressEscape();
    await waitFor(setup, (f) => f.includes("llm-bench"));

    setup.mockInput.pressKey("b");
    frame = await waitFor(setup, (f) => f.includes("Benchmark") && f.includes("Time to First Token"));
    assert(frame.includes("Prompt Caching"), "test list shows cache test");
    assert(frame.includes("Tool-Call Session TTFT"), "test list shows toolcall test");
    console.log("✓ benchmark test selector renders");

    setup.mockInput.pressEnter();
    frame = await waitFor(setup, (f) => f.includes("Running benchmarks"), 8000);
    console.log("✓ benchmark run screen renders");

    // wait for results
    frame = await waitFor(setup, (f) => f.includes("Results") && f.includes("TTFT"), 60000);
    assert(frame.includes("Time to First Token"), "results table lists tests");
    console.log("✓ benchmark completed and results rendered");

    // --- History screen: the run must have been saved ---
    setup.mockInput.pressEscape();
    await waitFor(setup, (f) => f.includes("llm-bench"));
    setup.mockInput.pressKey("h");
    frame = await waitFor(setup, (f) => f.includes("Benchmark history"));
    assert(frame.includes("mock-openai"), "history lists the saved run");
    assert(frame.includes("ok"), "history shows test status");
    console.log("✓ history screen lists the saved run");

    // Open the saved report
    setup.mockInput.pressEnter();
    frame = await waitFor(setup, (f) => f.includes("Results") && f.includes("Time to First Token"), 15000);
    console.log("✓ saved run report opens");

    console.log("\n✅ UI TESTS PASSED");
  } finally {
    setup.renderer.destroy();
  }
}

main().catch((err) => {
  console.error("\n❌ UI TEST FAILED:", err);
  process.exit(1);
});
