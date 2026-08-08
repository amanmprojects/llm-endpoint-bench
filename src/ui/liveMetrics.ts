// Live streaming metrics panel: TTFT count-up, tokens/sec, cost, cache, sparkline.
import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { C } from "./theme.ts";
import { addAll, labeledValue } from "./components.ts";
import { computeCost } from "../core/pricing.ts";
import { fmtCost, fmtMs, fmtNum, sparkline, estimateTokens } from "../core/format.ts";
import type { Pricing, Usage } from "../core/types.ts";

export interface LiveMetricsData {
  phase: "idle" | "connecting" | "streaming" | "done" | "error";
  elapsedMs: number;
  ttftMs: number | null;
  headersMs: number | null;
  chars: number;
  estTokens: number;
  tokPerSec: number | null;
  usage: Usage | null;
  error?: string;
}

export class LiveMetricsPanel {
  readonly box: BoxRenderable;
  private phaseText!: TextRenderable;
  private ttft!: ReturnType<typeof labeledValue>;
  private tps!: ReturnType<typeof labeledValue>;
  private outToks!: ReturnType<typeof labeledValue>;
  private inToks!: ReturnType<typeof labeledValue>;
  private cache!: ReturnType<typeof labeledValue>;
  private elapsed!: ReturnType<typeof labeledValue>;
  private cost!: ReturnType<typeof labeledValue>;
  private sparkText!: TextRenderable;
  private samples: number[] = [];
  private pricing: Pricing;

  constructor(renderer: CliRenderer, pricing: Pricing) {
    this.pricing = pricing;
    this.box = new BoxRenderable(renderer, {
      flexDirection: "column",
      width: "100%",
      paddingX: 1,
      paddingY: 0,
      gap: 0,
      backgroundColor: C.panelAlt,
    });

    this.phaseText = new TextRenderable(renderer, { content: "idle", fg: C.dim, attributes: 1 });
    this.ttft = labeledValue(renderer, "TTFT", "—", C.yellow);
    this.tps = labeledValue(renderer, "tok/s", "—", C.green);
    this.outToks = labeledValue(renderer, "out tokens", "—");
    this.inToks = labeledValue(renderer, "in tokens", "—");
    this.cache = labeledValue(renderer, "cache R/W", "—", C.cyan);
    this.elapsed = labeledValue(renderer, "elapsed", "—");
    this.cost = labeledValue(renderer, "cost", "$0.00", C.green);
    this.sparkText = new TextRenderable(renderer, { content: "", fg: C.cyan });

    addAll(
      this.box,
      this.phaseText,
      this.ttft.box,
      this.tps.box,
      this.outToks.box,
      this.inToks.box,
      this.cache.box,
      this.elapsed.box,
      this.cost.box,
      this.sparkText,
    );
  }

  reset(): void {
    this.samples = [];
    this.update({
      phase: "idle",
      elapsedMs: 0,
      ttftMs: null,
      headersMs: null,
      chars: 0,
      estTokens: 0,
      tokPerSec: null,
      usage: null,
    });
  }

  setPricing(p: Pricing): void {
    this.pricing = p;
  }

  update(data: LiveMetricsData): void {
    const phaseColor =
      data.phase === "streaming" ? C.yellow : data.phase === "done" ? C.green : data.phase === "error" ? C.red : C.dim;
    const phaseLabel =
      data.phase === "connecting"
        ? "● connecting…"
        : data.phase === "streaming"
          ? "● streaming…"
          : data.phase === "done"
            ? "● done"
            : data.phase === "error"
              ? "✖ error"
              : "idle";
    this.phaseText.content = phaseLabel;
    this.phaseText.fg = phaseColor;

    if (data.ttftMs != null) {
      this.ttft.set(fmtMs(data.ttftMs), C.yellow);
    } else if (data.phase === "connecting" || data.phase === "streaming") {
      this.ttft.set(`waiting… ${(data.elapsedMs / 1000).toFixed(2)}s`, C.dim);
    } else {
      this.ttft.set("—", C.yellow);
    }

    const tps = data.tokPerSec ?? (data.phase === "streaming" && data.ttftMs != null ? null : null);
    this.tps.set(tps != null ? `${fmtNum(tps, 1)}` : "—", C.green);
    if (tps != null) {
      this.samples.push(tps);
      if (this.samples.length > 90) this.samples = this.samples.slice(-90);
      const width = Math.max(8, Math.min(40, this.box.width ? this.box.width - 2 : 30));
      this.sparkText.content = sparkline(this.samples, width);
      this.sparkText.visible = true;
    } else if (this.samples.length === 0) {
      this.sparkText.content = "";
      this.sparkText.visible = false;
    }

    const usage = data.usage;
    const outTokens = usage?.outputTokens ?? estimateTokens(data.chars);
    const inTokens = usage?.inputTokens ?? 0;
    this.outToks.set(fmtNum(outTokens, 0));
    this.inToks.set(fmtNum(inTokens, 0));

    const cr = usage?.cacheReadTokens ?? 0;
    const cw = usage?.cacheWriteTokens ?? 0;
    if (cr > 0 || cw > 0) this.cache.set(`${fmtNum(cr, 0)} / ${fmtNum(cw, 0)}`, C.cyan);
    else this.cache.set("—", C.cyan);

    this.elapsed.set(fmtMs(data.elapsedMs));

    const cost = computeCost(this.pricing, {
      inputTokens: inTokens,
      outputTokens: outTokens,
      cacheReadTokens: cr,
      cacheWriteTokens: cw,
    });
    this.cost.set(fmtCost(cost), cost > 0 ? C.green : C.dim);
  }
}
