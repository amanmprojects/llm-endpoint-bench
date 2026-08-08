// Test checklist: choose which benchmarks to run.
import { BoxRenderable, TextRenderable } from "@opentui/core";
import type { App } from "../app.ts";
import { BaseScreen } from "../screen.ts";
import { C } from "../theme.ts";
import { headerBar, hintBar, addAll, panel } from "../components.ts";
import type { TestKind } from "../../core/types.ts";

interface TestDef {
  kind: TestKind;
  name: string;
  desc: string;
}

const TESTS: TestDef[] = [
  { kind: "ttft", name: "Time to First Token", desc: "stream one short completion; how long until the first token appears" },
  { kind: "throughput", name: "Output Throughput", desc: "stream a long completion; tokens/sec, steady-state speed" },
  { kind: "cache", name: "Prompt Caching", desc: "same big prompt twice; cache write → cache read, TTFT & cost savings" },
  { kind: "toolcall", name: "Tool-Call Session TTFT", desc: "agent-style: model calls a tool, then measure TTFT of the reply" },
];

export class TestSelectScreen extends BaseScreen {
  readonly root: BoxRenderable;
  private selected: Set<TestKind> = new Set(["ttft", "throughput", "cache", "toolcall"]);
  private cursor = 0;
  private iterations = 1;
  private listText!: TextRenderable;
  private statusText!: TextRenderable;

  constructor(app: App, private endpointId: string | null) {
    super(app);
    this.root = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: C.bg,
    });
  }

  override mount(): void {
    const { renderer } = this;
    const e = this.app.getEndpoint(this.endpointId);
    this.root.add(headerBar(renderer, "📊 Benchmark", e ? `${e.name} · ${e.model}` : "select an endpoint first"));

    const main = new BoxRenderable(renderer, { flexGrow: 1, width: "100%", padding: 1, gap: 1 });
    const listPanel = panel(renderer, { title: " Tests (space to toggle) ", flexGrow: 1, flexShrink: 1, minWidth: 0, titleColor: C.accent });
    this.listText = new TextRenderable(renderer, { content: "", fg: C.text });
    listPanel.add(this.listText);

    const right = new BoxRenderable(renderer, { flexDirection: "column", width: 40, gap: 1 });
    const infoPanel = panel(renderer, { title: " Run settings ", width: 40, titleColor: C.dim });
    this.statusText = new TextRenderable(renderer, { content: "", fg: C.dim });
    infoPanel.add(this.statusText);
    infoPanel.add(
      new TextRenderable(renderer, {
        content: "\nIterations: ",
        fg: C.dim,
      }),
    );
    right.add(infoPanel);
    addAll(main, listPanel, right);

    this.root.add(main);
    this.root.add(
      hintBar(renderer, [
        { key: "↑↓", label: "move" },
        { key: "space", label: "toggle" },
        { key: "a", label: "all" },
        { key: "n", label: "none" },
        { key: "◀▶", label: "iterations" },
        { key: "↵", label: "run" },
        { key: "esc", label: "back" },
      ]),
    );

    this.renderList();
  }

  private renderList(): void {
    const lines: string[] = [];
    TESTS.forEach((t, i) => {
      const mark = this.selected.has(t.kind) ? "☑" : "☐";
      const cursor = i === this.cursor ? "▶" : " ";
      lines.push(`${cursor} ${mark} ${t.name}`);
      lines.push(`      ${t.desc}`);
      lines.push("");
    });
    lines.pop();
    this.listText.content = lines.join("\n");
  }

  private renderStatus(): void {
    const e = this.app.getEndpoint(this.endpointId);
    if (!e) {
      this.statusText.content = "No endpoint selected.\nGo back and pick one.";
      return;
    }
    const names = TESTS.filter((t) => this.selected.has(t.kind)).map((t) => t.name);
    this.statusText.content =
      `Endpoint : ${e.name}\n` +
      `Provider : ${e.provider}\n` +
      `Base URL : ${e.baseUrl}\n` +
      `Model    : ${e.model}\n\n` +
      `Selected : ${names.length === 0 ? "—" : names.join(", ")}\n` +
      `Iterations: ${this.iterations}  (TTFT & throughput are averaged)`;
  }

  override onKey(key: import("@opentui/core").KeyEvent): void {
    switch (key.name) {
      case "up":
      case "k":
        this.cursor = (this.cursor - 1 + TESTS.length) % TESTS.length;
        this.renderList();
        break;
      case "down":
      case "j":
        this.cursor = (this.cursor + 1) % TESTS.length;
        this.renderList();
        break;
      case "space": {
        const kind = TESTS[this.cursor]!.kind;
        if (this.selected.has(kind)) this.selected.delete(kind);
        else this.selected.add(kind);
        this.renderList();
        break;
      }
      case "a":
        TESTS.forEach((t) => this.selected.add(t.kind));
        this.renderList();
        break;
      case "n":
        this.selected.clear();
        this.renderList();
        break;
      case "left":
        this.iterations = Math.max(1, this.iterations - 1);
        this.renderStatus();
        break;
      case "right":
        this.iterations = Math.min(10, this.iterations + 1);
        this.renderStatus();
        break;
      case "return":
      case "enter":
        this.run();
        break;
      case "escape":
        this.app.openDashboard();
        break;
      case "q":
        this.app.quit();
        break;
    }
    this.renderStatus();
  }

  private run(): void {
    const e = this.app.getEndpoint(this.endpointId);
    if (!e) {
      this.app.openDashboard();
      return;
    }
    if (this.selected.size === 0) return;
    const kinds = TESTS.filter((t) => this.selected.has(t.kind)).map((t) => t.kind);
    this.app.openBenchmarkRun(e.id, kinds, this.iterations);
  }
}
