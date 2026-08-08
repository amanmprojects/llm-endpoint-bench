// Dashboard: endpoint list + details + actions.
import { BoxRenderable, SelectRenderable, SelectRenderableEvents, TextRenderable } from "@opentui/core";
import type { App } from "../app.ts";
import { BaseScreen } from "../screen.ts";
import { C } from "../theme.ts";
import { headerBar, hintBar, addAll, labeledValue, panel } from "../components.ts";
import { maskKey } from "../../core/config.ts";
import { fmtCost } from "../../core/format.ts";
import type { Endpoint } from "../../core/types.ts";
import { confirmMenu, MenuScreen } from "./menu.ts";

export class DashboardScreen extends BaseScreen {
  readonly root: BoxRenderable;
  private endpointSelect!: SelectRenderable;
  private detailRows: ReturnType<typeof labeledValue>[] = [];
  private detailPanel!: BoxRenderable;
  private noEndpoints!: TextRenderable;

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
    const endpoints = app.endpoints;

    this.root.add(headerBar(renderer, "⚡ llm-bench", "LLM endpoint benchmark — press ? for keys"));

    const main = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1, width: "100%", gap: 1, padding: 1 });

    // Default the selection to the first endpoint so bare 'c'/'b' keys work.
    if (!app.selectedEndpointId && endpoints.length > 0) app.selectedEndpointId = endpoints[0]!.id;

    // --- Left: endpoints list ---
    const listPanel = panel(renderer, { title: " Endpoints ", flexGrow: 1, flexShrink: 1, minWidth: 0, titleColor: C.accent });
    if (endpoints.length === 0) {
      this.noEndpoints = new TextRenderable(renderer, {
        content: "No endpoints yet.\n\nPress [n] to add your first endpoint.\n\nSupports:\n  • OpenAI-compatible APIs (OpenAI, vLLM, Ollama, LM Studio, Groq, …)\n  • Anthropic Messages API\n\nYou will need:\n  • base URL\n  • API key / auth token\n  • model name",
        fg: C.dim,
      });
      listPanel.add(this.noEndpoints);
    } else {
      const options = endpoints.map((e) => ({
        name: e.name,
        description: `${e.model} · ${e.provider}`,
        value: e.id,
      }));
      this.endpointSelect = new SelectRenderable(renderer, {
        width: "100%",
        height: Math.max(5, Math.min(endpoints.length + 2, 20)),
        options,
        selectedIndex: Math.max(0, endpoints.findIndex((e) => e.id === app.selectedEndpointId)),
        selectedBackgroundColor: C.panelAlt,
        selectedTextColor: C.accent,
        textColor: C.text,
        descriptionColor: C.dim,
        selectedDescriptionColor: C.cyan,
        showScrollIndicator: true,
      });
      this.endpointSelect.on(SelectRenderableEvents.SELECTION_CHANGED, (_i, option) => {
        app.selectedEndpointId = String(option.value ?? "");
        this.renderDetails();
      });
      this.endpointSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_i) => {
        this.openActionMenu();
      });
      listPanel.add(this.endpointSelect);
    }

    // --- Right: details ---
    this.detailPanel = panel(renderer, { title: " Endpoint details ", width: 46, titleColor: C.dim });
    const drow = (label: string) => {
      const row = labeledValue(renderer, label);
      this.detailRows.push(row);
      this.detailPanel.add(row.box);
    };
    drow("Name");
    drow("Provider");
    drow("Base URL");
    drow("API key");
    drow("Model");
    drow("$ input /1M");
    drow("$ output /1M");
    drow("$ cache read/1M");
    drow("$ cache write/1M");
    this.detailPanel.add(
      new TextRenderable(renderer, { content: "Enter on an endpoint to run tests / chat.", fg: C.faint }),
    );
    this.renderDetails();

    addAll(main, listPanel, this.detailPanel);
    this.root.add(main);
    this.root.add(
      hintBar(renderer, [
        { key: "↵", label: "actions" },
        { key: "n", label: "new" },
        { key: "c", label: "chat" },
        { key: "b", label: "benchmark" },
        { key: "h", label: "history" },
        { key: "e", label: "edit" },
        { key: "d", label: "delete" },
        { key: "r", label: "refresh" },
        { key: "q", label: "quit" },
      ]),
    );

    if (this.endpointSelect) this.endpointSelect.focus();
  }

  private currentEndpoint(): Endpoint | undefined {
    return this.app.getEndpoint(this.app.selectedEndpointId);
  }

  renderDetails(): void {
    const e = this.currentEndpoint();
    const rows = this.detailRows;
    if (!e) {
      rows[0]?.set("—");
      rows[1]?.set("—");
      rows[2]?.set("—");
      rows[3]?.set("—");
      rows[4]?.set("—");
      rows[5]?.set("—");
      rows[6]?.set("—");
      rows[7]?.set("—");
      rows[8]?.set("—");
      return;
    }
    rows[0]?.set(e.name, C.text);
    rows[1]?.set(e.provider, e.provider === "anthropic" ? C.purple : C.cyan);
    rows[2]?.set(e.baseUrl, C.accent);
    rows[3]?.set(maskKey(e.apiKey));
    rows[4]?.set(e.model, C.yellow);
    rows[5]?.set(fmtCost(e.pricing.input), C.green);
    rows[6]?.set(fmtCost(e.pricing.output), C.green);
    rows[7]?.set(fmtCost(e.pricing.cacheRead), C.greenDim);
    rows[8]?.set(fmtCost(e.pricing.cacheWrite), C.greenDim);
  }

  private openActionMenu(): void {
    const e = this.currentEndpoint();
    if (!e) return;
    const screen = new MenuScreen(this.app, {
      title: ` ${e.name} `,
      options: [
        { name: "💬  Interactive chat", description: "stream tokens live, see TTFT & cost per message" },
        { name: "📊  Run benchmarks", description: "TTFT · throughput · caching · tool-call latency" },
        { name: "✏️  Edit endpoint", description: "change URL, key, model, pricing" },
        { name: "🗑  Delete endpoint", description: "remove from config" },
        { name: "Cancel", description: "" },
      ],
      onSelect: (_i, opt) => {
        switch (opt.name) {
          case "💬  Interactive chat":
            this.app.openChat(e.id);
            break;
          case "📊  Run benchmarks":
            this.app.openBenchmarkSelect(e.id);
            break;
          case "✏️  Edit endpoint":
            this.app.openEndpointForm(e.id);
            break;
          case "🗑  Delete endpoint":
            confirmMenu(this.app, " Delete endpoint? ", `Remove "${e.name}" (${e.model})?`, () => {
              this.app.config.remove(e.id);
              this.app.selectedEndpointId = null;
              this.app.refreshEndpoints();
              this.app.openDashboard();
            }, () => this.app.openDashboard());
            break;
          default:
            this.app.openDashboard();
        }
      },
      onCancel: () => this.app.openDashboard(),
    });
    this.app.setScreen(screen);
  }

  override onKey(key: import("@opentui/core").KeyEvent): void {
    switch (key.name) {
      case "n":
        this.app.openEndpointForm(null);
        break;
      case "c":
        this.app.openChat(this.app.selectedEndpointId);
        break;
      case "b":
        this.app.openBenchmarkSelect(this.app.selectedEndpointId);
        break;
      case "h":
        this.app.openHistory();
        break;
      case "e":
        if (this.currentEndpoint()) this.app.openEndpointForm(this.app.selectedEndpointId);
        break;
      case "d":
        if (this.currentEndpoint()) this.openActionMenu();
        break;
      case "r":
        this.app.refreshEndpoints();
        this.app.openDashboard();
        break;
      case "q":
        this.app.quit();
        break;
      case "?":
        this.app.openHelp();
        break;
    }
  }
}
