// Results screen: benchmark summary table + per-test detail.
import { BoxRenderable, TextRenderable, TextTableRenderable, RGBA } from "@opentui/core";
import type { App } from "../app.ts";
import { BaseScreen } from "../screen.ts";
import { C } from "../theme.ts";
import { headerBar, hintBar, panel } from "../components.ts";
import { fmtCost, fmtMs, fmtNum, fmtPct } from "../../core/format.ts";
import type { TestResult } from "../../core/types.ts";
import { statusColor } from "../theme.ts";

const cell = (text: string, fg?: string) => [{ __isChunk: true as const, text, fg: fg ? RGBA.fromHex(fg) : undefined }];

export class ResultsScreen extends BaseScreen {
  readonly root: BoxRenderable;
  private results: TestResult[];
  private endpointName: string;
  private endpointId: string | null;
  private cursor = 0;
  private table!: TextTableRenderable;
  private detailText!: TextRenderable;
  private summaryText!: TextRenderable;

  constructor(app: App, endpointId: string | null, results: TestResult[], labelOverride?: string) {
    super(app);
    const ep = app.getEndpoint(endpointId);
    this.endpointName = labelOverride ?? (ep ? `${ep.name} · ${ep.model}` : "benchmark");
    this.endpointId = endpointId;
    this.results = results;
    this.root = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: C.bg,
    });
  }

  override mount(): void {
    const { renderer } = this;
    this.root.add(headerBar(renderer, "📊 Results", this.endpointName));

    const main = new BoxRenderable(renderer, { flexDirection: "column", flexGrow: 1, width: "100%", gap: 1, padding: 1, minHeight: 0 });
    const tablePanel = panel(renderer, { title: " Summary ", flexGrow: 1, titleColor: C.accent });
    this.table = new TextTableRenderable(renderer, {
      width: "100%",
      wrapMode: "none",
      columnWidthMode: "full",
      borderStyle: "rounded",
      borderColor: C.border,
      cellPaddingX: 1,
      content: [],
    });
    tablePanel.add(this.table);
    main.add(tablePanel);

    const detailPanel = panel(renderer, { title: " Details (↑/↓ to inspect) ", height: 11, titleColor: C.dim });
    this.detailText = new TextRenderable(renderer, { content: "", fg: C.text });
    detailPanel.add(this.detailText);
    main.add(detailPanel);

    this.summaryText = new TextRenderable(renderer, { content: "", fg: C.dim, height: 1, paddingLeft: 1 });
    main.add(this.summaryText);
    this.root.add(main);

    this.root.add(
      hintBar(renderer, [
        { key: "↑↓", label: "inspect" },
        { key: "r", label: "re-run" },
        { key: "esc", label: "back" },
        { key: "q", label: "quit" },
      ]),
    );

    this.renderTable();
    this.renderDetail();
    this.renderSummary();
  }

  private renderTable(): void {
    const rows: ReturnType<typeof cell>[][] = [
      [cell(" "), cell("Test", C.dim), cell("Status", C.dim), cell("TTFT", C.dim), cell("tok/s", C.dim), cell("in", C.dim), cell("out", C.dim), cell("cache R/W", C.dim), cell("cost", C.dim)],
    ];
    this.results.forEach((r, i) => {
      const sel = i === this.cursor;
      const name = r.name;
      const t0 = r.turns[0];
      const ttft = t0?.ttftMs ?? null;
      const tps = t0?.tokensPerSec ?? null;
      const cache = r.cache;
      const cacheStr = cache ? `${fmtNum(cache.cacheReadTokens, 0)}/${fmtNum(cache.cacheWriteTokens, 0)}` : `${fmtNum(r.totalUsage.cacheReadTokens, 0)}/${fmtNum(r.totalUsage.cacheWriteTokens, 0)}`;
      rows.push([
        cell(sel ? "▶" : " ", sel ? C.accent : C.faint),
        cell(name, sel ? C.text : C.text),
        cell(r.status === "ok" ? "ok" : "error", statusColor(r.status)),
        cell(fmtMs(ttft), C.yellow),
        cell(fmtNum(tps, 1), C.green),
        cell(fmtNum(r.totalUsage.inputTokens, 0)),
        cell(fmtNum(r.totalUsage.outputTokens, 0)),
        cell(cacheStr, C.cyan),
        cell(fmtCost(r.totalCost), C.green),
      ]);
    });
    this.table.content = rows;
  }

  private renderDetail(): void {
    const r = this.results[this.cursor];
    if (!r) {
      this.detailText.content = "No results.";
      return;
    }
    if (r.status === "error") {
      this.detailText.content = `✖ ${r.name} failed:\n${r.error ?? "unknown error"}`;
      return;
    }
    const lines: string[] = [];
    for (const t of r.turns) {
      lines.push(
        `${t.label.padEnd(24)}  TTFT ${fmtMs(t.ttftMs).padStart(9)}  ${fmtNum(t.tokensPerSec, 1).padStart(7)} tok/s  ` +
          `in ${fmtNum(t.inputTokens, 0).padStart(6)}  out ${fmtNum(t.outputTokens, 0).padStart(6)}  ` +
          `cache ${fmtNum(t.cacheReadTokens, 0)}/${fmtNum(t.cacheWriteTokens, 0)}  ${fmtCost(t.cost)}` +
          (t.reasoningTokens ? `  think ${fmtNum(t.reasoningTokens, 0)}` : ""),
      );
      if (t.toolCalls.length > 0) {
        for (const tc of t.toolCalls) lines.push(`    ⚙ tool call: ${tc.name}(${tc.input.slice(0, 80)})`);
      }
      if (t.note) lines.push(`    note: ${t.note}`);
    }
    if (r.cache) {
      const c = r.cache;
      lines.push("");
      lines.push(
        `cache: read ${fmtNum(c.cacheReadTokens, 0)} tok (${fmtPct(c.cacheReadPct)} of prompt) · written ${fmtNum(c.cacheWriteTokens, 0)} tok`,
      );
      lines.push(
        `TTFT: cold ${fmtMs(c.ttftColdMs)} → warm ${fmtMs(c.ttftWarmMs)} · cost cold ${fmtCost(c.costCold)} → warm ${fmtCost(c.costWarm)} (saved ${fmtCost(c.costSavings)})`,
      );
      if (!c.cacheSupported) lines.push(`note: provider reported no cache metrics — prompt caching may be unsupported for this model/endpoint.`);
    }
    this.detailText.content = lines.join("\n");
  }

  private renderSummary(): void {
    const ok = this.results.filter((r) => r.status === "ok");
    const totalCost = this.results.reduce((s, r) => s + r.totalCost, 0);
    const avgTtft = ok.length > 0 ? ok.reduce((s, r) => s + (r.turns[0]?.ttftMs ?? 0), 0) / ok.length : null;
    const avgTps = ok.length > 0 ? ok.reduce((s, r) => s + (r.turns[0]?.tokensPerSec ?? 0), 0) / ok.length : null;
    const totalOut = this.results.reduce((s, r) => s + r.totalUsage.outputTokens, 0);
    this.summaryText.content =
      `${ok.length}/${this.results.length} tests ok · avg TTFT ${fmtMs(avgTtft)} · avg ${fmtNum(avgTps, 1)} tok/s · ` +
      `${fmtNum(totalOut, 0)} output tokens · total cost ${fmtCost(totalCost)}`;
  }

  override onKey(key: import("@opentui/core").KeyEvent): void {
    switch (key.name) {
      case "up":
      case "k":
        if (this.results.length === 0) break;
        this.cursor = (this.cursor - 1 + this.results.length) % this.results.length;
        this.renderTable();
        this.renderDetail();
        break;
      case "down":
      case "j":
        if (this.results.length === 0) break;
        this.cursor = (this.cursor + 1) % this.results.length;
        this.renderTable();
        this.renderDetail();
        break;
      case "r": {
        const kinds = this.results.map((r) => r.kind);
        if (kinds.length > 0 && this.endpointId && this.app.getEndpoint(this.endpointId)) {
          this.app.openBenchmarkRun(this.endpointId, kinds, 1);
        }
        break;
      }
      case "escape":
        this.app.openDashboard();
        break;
      case "q":
        this.app.quit();
        break;
    }
  }
}
