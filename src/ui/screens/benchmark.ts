// Benchmark runner screen: shows live progress + metrics while tests execute.
import { BoxRenderable, TextRenderable } from "@opentui/core";
import type { App } from "../app.ts";
import { BaseScreen } from "../screen.ts";
import { C } from "../theme.ts";
import { headerBar, hintBar, addAll, panel } from "../components.ts";
import { runBenchmarks, type BenchProgress } from "../../bench/runner.ts";
import { fmtCost, fmtMs, fmtNum, fmtPct } from "../../core/format.ts";
import type { Endpoint, TestKind, TestResult } from "../../core/types.ts";
import { statusColor } from "../theme.ts";
import { LiveMetricsPanel } from "../liveMetrics.ts";

const TEST_NAMES: Record<TestKind, string> = {
  ttft: "Time to First Token",
  throughput: "Output Throughput",
  cache: "Prompt Caching",
  toolcall: "Tool-Call Session TTFT",
};

export class BenchmarkRunScreen extends BaseScreen {
  readonly root: BoxRenderable;
  private endpoint: Endpoint;
  private kinds: TestKind[];
  private iterations: number;
  private abortController = new AbortController();
  private progressLines: TextRenderable[] = [];
  private progressBox!: BoxRenderable;
  private statusText!: TextRenderable;
  private metrics!: LiveMetricsPanel;
  private finished = false;

  constructor(app: App, endpointId: string | null, kinds: TestKind[], iterations: number) {
    super(app);
    const ep = app.getEndpoint(endpointId);
    if (!ep) throw new Error("no endpoint");
    this.endpoint = ep;
    this.kinds = kinds;
    this.iterations = iterations;
    this.root = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: C.bg,
    });
  }

  override mount(): void {
    const { renderer } = this;
    this.root.add(
      headerBar(renderer, "📊 Running benchmarks", `${this.endpoint.name} · ${this.endpoint.model}`),
    );

    const main = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1, width: "100%", gap: 1, padding: 1, minHeight: 0 });

    const leftPanel = panel(renderer, { title: " Progress ", flexGrow: 1, flexShrink: 1, minWidth: 0, titleColor: C.accent });
    this.progressBox = new BoxRenderable(renderer, { flexDirection: "column", gap: 1, width: "100%" });
    for (let i = 0; i < this.kinds.length * this.iterations; i++) {
      const line = new TextRenderable(renderer, { content: "○ pending", fg: C.dim });
      this.progressLines.push(line);
      this.progressBox.add(line);
    }
    this.statusText = new TextRenderable(renderer, { content: "starting…", fg: C.yellow, paddingTop: 1 });
    addAll(leftPanel, this.progressBox, this.statusText);
    main.add(leftPanel);

    const rightPanel = panel(renderer, { title: " Live request ", width: 46, titleColor: C.yellow });
    this.metrics = new LiveMetricsPanel(renderer, this.endpoint.pricing);
    rightPanel.add(this.metrics.box);
    main.add(rightPanel);

    this.root.add(main);
    this.root.add(
      hintBar(renderer, [
        { key: "Ctrl+C", label: "abort run" },
      ]),
    );

    void this.run();
  }

  private async run(): Promise<void> {
    this.app.busy = true;
    try {
      const results = await runBenchmarks({
        endpoint: this.endpoint,
        kinds: this.kinds,
        iterations: this.iterations,
        signal: this.abortController.signal,
        onProgress: (p) => {
          if (this.finished) return;
          this.renderProgress(p);
        },
      });
      if (this.finished) return;
      this.finished = true;
      // Persist the run for later browsing (even partial/aborted runs).
      if (results.length > 0) {
        this.app.saveRun({
          endpointId: this.endpoint.id,
          endpointLabel: this.endpoint.name,
          provider: this.endpoint.provider,
          model: this.endpoint.model,
          baseUrl: this.endpoint.baseUrl,
          kinds: this.kinds,
          iterations: this.iterations,
          results,
          totalCost: results.reduce((s, r) => s + r.totalCost, 0),
        });
      }
      this.app.openResults(this.endpoint.id, results);
    } finally {
      this.app.busy = false;
    }
  }

  private renderProgress(p: BenchProgress): void {
    const flatKinds = this.kinds.flatMap((k) => Array.from({ length: this.iterations }, () => k));
    for (let i = 0; i < this.progressLines.length; i++) {
      const kind = flatKinds[i];
      const done = p.done[i];
      const isCurrent = i === p.done.length && !done;
      const line = this.progressLines[i];
      if (!line) continue;
      if (done) {
        const ttft = done.turns[0]?.ttftMs;
        const tps = done.turns[0]?.tokensPerSec;
        const summary =
          done.status === "ok"
            ? `✓ ${TEST_NAMES[kind ?? "ttft"]}  TTFT ${fmtMs(ttft)} · ${fmtNum(tps, 1)} tok/s · ${fmtCost(done.totalCost)}`
            : `✖ ${TEST_NAMES[kind ?? "ttft"]}  ${done.error ?? "error"}`;
        line.content = summary;
        line.fg = statusColor(done.status);
      } else if (isCurrent) {
        line.content = `▶ ${TEST_NAMES[kind ?? "ttft"]}  ${p.status}`;
        line.fg = C.yellow;
      } else {
        line.content = `○ ${TEST_NAMES[kind ?? "ttft"]}`;
        line.fg = C.dim;
      }
    }
    this.statusText.content = `${p.testIndex}/${p.testCount} — ${p.status}`;
    if (p.live) {
      const l = p.live;
      this.metrics.update({
        phase: l.phase,
        elapsedMs: l.elapsedMs,
        ttftMs: l.ttftMs,
        headersMs: l.headersMs,
        chars: l.chars,
        estTokens: l.estTokens,
        tokPerSec: l.tokPerSec,
        usage: l.usage,
      });
    }
  }

  override onCtrlC(): void {
    if (!this.finished) {
      this.abortController.abort();
      this.statusText.content = "aborting…";
      this.metrics.update({ phase: "error", elapsedMs: 0, ttftMs: null, headersMs: null, chars: 0, estTokens: 0, tokPerSec: null, usage: null });
    } else {
      this.app.quit();
    }
  }

  override onKey(key: import("@opentui/core").KeyEvent): void {
    if (key.name === "escape" && !this.finished) {
      this.abortController.abort();
    }
  }
}
