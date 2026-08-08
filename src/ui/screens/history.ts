// History screen: browse past benchmark runs.
import { BoxRenderable, SelectRenderable, SelectRenderableEvents, TextRenderable } from "@opentui/core";
import type { App } from "../app.ts";
import { BaseScreen } from "../screen.ts";
import { C } from "../theme.ts";
import { headerBar, hintBar, addAll, panel } from "../components.ts";
import { fmtCost, fmtDuration, fmtMs, fmtNum, truncate } from "../../core/format.ts";
import type { RunRecord } from "../../core/history.ts";
import { confirmMenu } from "./menu.ts";

export class HistoryScreen extends BaseScreen {
  readonly root: BoxRenderable;
  private select!: SelectRenderable;
  private detailText!: TextRenderable;
  private noRuns!: TextRenderable;
  private empty = false;

  constructor(app: App) {
    super(app);
    this.root = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: C.bg,
    });
  }

  override mount(): void {
    const { renderer, app } = this;
    this.root.add(headerBar(renderer, "🗂 Benchmark history", `${app.history.runs.length} saved run${app.history.runs.length === 1 ? "" : "s"}`));

    const main = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1, width: "100%", gap: 1, padding: 1, minHeight: 0 });

    const listPanel = panel(renderer, { title: " Runs (newest first) ", flexGrow: 1, flexShrink: 1, minWidth: 0, titleColor: C.accent });
    const runs = app.history.runs;
    if (runs.length === 0) {
      this.empty = true;
      this.noRuns = new TextRenderable(renderer, {
        content: "No saved runs yet.\n\nRun benchmarks from the dashboard (b) and every run is saved here.\n\nPress Enter / Esc to go back.",
        fg: C.dim,
      });
      listPanel.add(this.noRuns);
    } else {
      const options = runs.map((r) => ({
        name: this.runTitle(r),
        description: this.runSubtitle(r),
        value: r.id,
      }));
      this.select = new SelectRenderable(renderer, {
        width: "100%",
        height: Math.max(5, Math.min(runs.length + 2, 18)),
        options,
        selectedBackgroundColor: C.panelAlt,
        selectedTextColor: C.accent,
        textColor: C.text,
        descriptionColor: C.dim,
        selectedDescriptionColor: C.cyan,
        showScrollIndicator: true,
      });
      this.select.on(SelectRenderableEvents.SELECTION_CHANGED, (_i, opt) => {
        const r = app.history.runs.find((x) => x.id === opt.value);
        this.renderDetail(r);
      });
      this.select.on(SelectRenderableEvents.ITEM_SELECTED, (_i, opt) => {
        const r = app.history.runs.find((x) => x.id === opt.value);
        if (r) this.openRun(r);
      });
      listPanel.add(this.select);
    }

    const detailPanel = panel(renderer, { title: " Details (↵ opens full report) ", width: 62, titleColor: C.dim });
    this.detailText = new TextRenderable(renderer, { content: "", fg: C.text });
    detailPanel.add(this.detailText);
    addAll(main, listPanel, detailPanel);
    this.root.add(main);
    this.root.add(
      hintBar(renderer, [
        { key: "↵", label: "open report" },
        { key: "d", label: "delete run" },
        { key: "x", label: "clear all" },
        { key: "esc", label: "back" },
      ]),
    );

    if (this.select) {
      this.select.focus();
      this.renderDetail(app.history.runs[0]);
    }
  }

  private runTitle(r: RunRecord): string {
    const d = new Date(r.timestamp);
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    return `${ts}  ${r.endpointLabel}`;
  }

  private runSubtitle(r: RunRecord): string {
    const ok = r.results.filter((x) => x.status === "ok").length;
    return `${r.model} · ${ok}/${r.results.length} ok · ${r.kinds.join("+")} ×${r.iterations} · ${fmtCost(r.totalCost)}`;
  }

  private renderDetail(r: RunRecord | undefined): void {
    if (!r) {
      this.detailText.content = "—";
      return;
    }
    const lines: string[] = [
      `${r.endpointLabel}`,
      `${r.model} · ${r.provider} · ${truncate(r.baseUrl, 50)}`,
      `run at ${new Date(r.timestamp).toLocaleString()} · ${r.kinds.join(", ")} × ${r.iterations}`,
      "",
    ];
    for (const res of r.results) {
      if (res.status !== "ok") {
        lines.push(`✖ ${res.name}: ${truncate(res.error ?? "error", 60)}`);
        continue;
      }
      const t0 = res.turns[0];
      const ttft = fmtMs(t0?.ttftMs);
      const tps = fmtNum(t0?.tokensPerSec, 1);
      const think = t0?.reasoningTokens ? ` think ${fmtNum(t0.reasoningTokens, 0)}` : "";
      lines.push(`✓ ${res.name.padEnd(28)} TTFT ${ttft.padStart(8)}  ${tps.padStart(6)} tok/s  ${fmtCost(res.totalCost)}${think}`);
      if (res.cache) {
        lines.push(`    cache ${fmtNum(res.cache.cacheReadTokens, 0)}R / ${fmtNum(res.cache.cacheWriteTokens, 0)}W (${(res.cache.cacheReadPct * 100).toFixed(0)}%) · cold ${fmtMs(res.cache.ttftColdMs)} → warm ${fmtMs(res.cache.ttftWarmMs)}`);
      }
    }
    const totalMs = r.results.reduce((s, x) => s + x.durationMs, 0);
    lines.push("", `total: ${fmtDuration(totalMs)} · ${fmtCost(r.totalCost)}`);
    this.detailText.content = lines.join("\n");
  }

  private openRun(r: RunRecord): void {
    this.app.openResults(null, r.results, `${r.endpointLabel} · ${r.model} · ${new Date(r.timestamp).toLocaleString()}`);
  }

  override onKey(key: import("@opentui/core").KeyEvent): void {
    switch (key.name) {
      case "escape":
        this.app.openDashboard();
        break;
      case "d": {
        const r = this.app.history.runs[this.select?.getSelectedIndex() ?? 0];
        if (r) {
          confirmMenu(this.app, " Delete run? ", `Delete the run from ${new Date(r.timestamp).toLocaleString()}?`, () => {
            this.app.history.remove(r.id);
            this.app.openHistory();
          }, () => this.app.openHistory());
        }
        break;
      }
      case "x":
        if (this.app.history.runs.length > 0) {
          confirmMenu(this.app, " Clear all history? ", `Delete all ${this.app.history.runs.length} saved runs?`, () => {
            this.app.history.clear();
            this.app.openHistory();
          }, () => this.app.openHistory());
        }
        break;
      case "q":
        this.app.quit();
        break;
    }
  }
}
