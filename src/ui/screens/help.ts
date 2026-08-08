// Help screen.
import { BoxRenderable, TextRenderable } from "@opentui/core";
import type { App } from "../app.ts";
import { BaseScreen } from "../screen.ts";
import { C } from "../theme.ts";
import { headerBar, hintBar, panel } from "../components.ts";

export class HelpScreen extends BaseScreen {
  readonly root: BoxRenderable;

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
    const { renderer } = this;
    this.root.add(headerBar(renderer, "❓ Help", "llm-bench — LLM endpoint benchmark"));

    const main = new BoxRenderable(renderer, { flexGrow: 1, width: "100%", padding: 1, alignItems: "center", justifyContent: "center" });
    const p = panel(renderer, { title: " Keys & what this tool does ", width: 86, titleColor: C.accent });
    p.add(
      new TextRenderable(renderer, {
        content: `\nWhat it tests
  • Time to First Token (TTFT)      — latency until the first token streams back
  • Output throughput               — tokens/sec during long generations
  • Prompt caching                  — cold vs warm requests: cache read/write tokens, TTFT & cost savings
  • Tool-call session TTFT          — agent-style loop: model calls a tool, then TTFT of the reply after the tool result
  • Interactive chat                — watch tokens stream in live, per-message TTFT, cache and cost

Endpoints
  OpenAI-compatible: any base URL ending in /v1 (OpenAI, vLLM, Ollama, LM Studio, Groq, Together, …)
  Anthropic:        base URL ending in /v1 (https://api.anthropic.com/v1 or any proxy)
  API keys:         literal value or env:VAR_NAME — stored in ~/.llm-bench/endpoints.json
  Pricing:          USD per 1M tokens; auto-filled for known models (Ctrl+R in the form), used for cost reporting

Keys
  Dashboard:    ↵ actions · n new endpoint · c chat · b benchmark · e edit · d delete · r refresh · q quit
  Form:         Ctrl+S save · Esc cancel · Tab next field · Ctrl+R autofill pricing
  Chat:         Enter send · Esc abort/back · Ctrl+X new session
  Benchmarks:   space toggle test · a all · n none · ◀▶ iterations · Enter run · Ctrl+C abort
  Results:      ↑↓ inspect · r re-run · Esc back
  Anywhere:     Ctrl+C (when idle) quits — during a run/stream it aborts the current request`,
        fg: C.text,
      }),
    );
    main.add(p);
    this.root.add(main);
    this.root.add(hintBar(renderer, [{ key: "esc", label: "back" }]));
  }

  override onKey(key: import("@opentui/core").KeyEvent): void {
    if (key.name === "escape" || key.name === "q" || key.name === "return" || key.name === "enter") {
      this.app.openDashboard();
    }
  }
}
