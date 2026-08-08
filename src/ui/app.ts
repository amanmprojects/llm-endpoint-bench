// Application shell: owns the renderer, config store, and screen routing.
import { createCliRenderer, BoxRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { ConfigStore } from "../core/config.ts";
import { HistoryStore, type RunRecord } from "../core/history.ts";
import type { Endpoint, TestKind, TestResult } from "../core/types.ts";
import { C } from "./theme.ts";
import type { Screen } from "./screen.ts";

export class App {
  renderer!: CliRenderer;
  config = new ConfigStore();
  history = new HistoryStore();
  endpoints: Endpoint[] = [];
  screen: Screen | null = null;
  appRoot!: BoxRenderable;
  /** Currently selected endpoint id in the dashboard. */
  selectedEndpointId: string | null = null;
  /** True while a stream or benchmark is in flight (Ctrl+C aborts instead of quitting). */
  busy = false;

  async start(renderer?: CliRenderer): Promise<void> {
    this.endpoints = this.config.load();
    this.history.load();
    this.renderer =
      renderer ??
      (await createCliRenderer({
        exitOnCtrlC: false,
        exitSignals: ["SIGTERM", "SIGQUIT", "SIGABRT", "SIGHUP", "SIGBREAK", "SIGPIPE", "SIGBUS"],
        backgroundColor: C.bg,
      }));
    this.appRoot = new BoxRenderable(this.renderer, {
      id: "app-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: C.bg,
    });
    this.renderer.root.add(this.appRoot);

    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
      if (key.ctrl && key.name === "c") {
        this.onCtrlC();
        return;
      }
      if (this.screen) this.screen.onKey?.(key);
    });

    const { DashboardScreen } = await import("./screens/dashboard.ts");
    this.setScreen(new DashboardScreen(this));
  }

  setScreen(screen: Screen): void {
    if (this.screen) {
      try {
        this.screen.unmount();
      } catch {
        /* ignore teardown errors */
      }
    }
    this.screen = screen;
    this.appRoot.add(screen.root);
    screen.mount();
  }

  onCtrlC(): void {
    if (this.busy) {
      // Abort handled by the active screen (it owns the AbortController).
      this.screen?.onCtrlC?.();
      return;
    }
    this.quit();
  }

  quit(): void {
    try {
      this.renderer.destroy();
    } catch {
      /* ignore */
    }
    process.exit(0);
  }

  refreshEndpoints(): void {
    this.endpoints = this.config.load();
  }

  getEndpoint(id: string | null): Endpoint | undefined {
    if (!id) return undefined;
    return this.endpoints.find((e) => e.id === id);
  }

  async openDashboard(): Promise<void> {
    this.refreshEndpoints();
    const { DashboardScreen } = await import("./screens/dashboard.ts");
    this.setScreen(new DashboardScreen(this));
  }

  async openHelp(): Promise<void> {
    const { HelpScreen } = await import("./screens/help.ts");
    this.setScreen(new HelpScreen(this));
  }

  async openEndpointForm(endpointId: string | null): Promise<void> {
    const { EndpointFormScreen } = await import("./screens/endpointForm.ts");
    this.setScreen(new EndpointFormScreen(this, endpointId));
  }

  async openChat(endpointId: string | null): Promise<void> {
    const { ChatScreen } = await import("./screens/chat.ts");
    this.setScreen(new ChatScreen(this, endpointId));
  }

  async openBenchmarkSelect(endpointId: string | null): Promise<void> {
    const { TestSelectScreen } = await import("./screens/testSelect.ts");
    this.setScreen(new TestSelectScreen(this, endpointId));
  }

  async openBenchmarkRun(endpointId: string | null, kinds: TestKind[], iterations: number): Promise<void> {
    const { BenchmarkRunScreen } = await import("./screens/benchmark.ts");
    this.setScreen(new BenchmarkRunScreen(this, endpointId, kinds, iterations));
  }

  async openResults(endpointId: string | null, results: TestResult[], labelOverride?: string): Promise<void> {
    const { ResultsScreen } = await import("./screens/results.ts");
    this.setScreen(new ResultsScreen(this, endpointId, results, labelOverride));
  }

  async openHistory(): Promise<void> {
    const { HistoryScreen } = await import("./screens/history.ts");
    this.setScreen(new HistoryScreen(this));
  }

  /** Persist a finished benchmark run (TUI + headless). */
  saveRun(run: Omit<RunRecord, "id" | "timestamp">): RunRecord {
    return this.history.add(run);
  }
}
