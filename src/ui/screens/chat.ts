// Interactive chat screen: live token streaming, per-turn TTFT, tool calls, cost.
import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  MarkdownRenderable,
  RenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { App } from "../app.ts";
import { BaseScreen } from "../screen.ts";
import { C, markdownStyle, thinkingMarkdownStyle } from "../theme.ts";
import { headerBar, hintBar, addAll, panel } from "../components.ts";
import { createClient } from "../../core/clients/factory.ts";
import { computeCost } from "../../core/pricing.ts";
import { fmtCost, fmtMs, fmtNum, fmtPct } from "../../core/format.ts";
import type { ChatMsg, LLMClient, ToolDef } from "../../core/clients/client.ts";
import { CALCULATOR_TOOL, TIME_TOOL, executeTool } from "../../core/clients/client.ts";
import type { Endpoint, ToolCallInfo, TurnMetrics, Usage } from "../../core/types.ts";
import { EMPTY_USAGE } from "../../core/types.ts";
import { LiveMetricsPanel } from "../liveMetrics.ts";

interface ChatTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Reasoning/thinking text for assistant turns. */
  reasoning?: string;
  toolCalls?: ToolCallInfo[];
  toolResults?: Array<{ toolCallId: string; content: string }>;
}

interface TurnRecord {
  label: string;
  ttft: number | null;
  kind: "user" | "tool";
  ok: boolean;
}

const TOOLS: ToolDef[] = [CALCULATOR_TOOL, TIME_TOOL];
const MAX_TOOL_ROUNDS = 6;
const MARKDOWN_FLUSH_MS = 40;
const METRICS_FLUSH_MS = 90;

export class ChatScreen extends BaseScreen {
  readonly root: BoxRenderable;
  private endpoint: Endpoint;
  private client: LLMClient;
  private scroll!: ScrollBoxRenderable;
  private input!: InputRenderable;
  private metrics!: LiveMetricsPanel;
  private turnsText!: TextRenderable;
  private sessionText!: TextRenderable;
  private statusText!: TextRenderable;

  private turns: ChatTurn[] = [];
  private sessionUsage: Usage = { ...EMPTY_USAGE };
  private sessionCost = 0;
  private sessionReasoningChars = 0;
  private turnTtfts: TurnRecord[] = [];
  private streaming = false;
  private thinkingFinalized = false;
  private abortController: AbortController | null = null;
  private toolRounds = 0;
  private lastMetrics = 0;
  private lastMdFlush = 0;

  constructor(app: App, endpointId: string | null) {
    super(app);
    const ep = app.getEndpoint(endpointId);
    if (!ep) {
      // No endpoint: show a bare screen and go back.
      this.endpoint = null as unknown as Endpoint;
      this.client = null as unknown as LLMClient;
    } else {
      this.endpoint = ep;
      this.client = createClient(ep);
    }
    this.root = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: C.bg,
    });
  }

  override mount(): void {
    const { renderer } = this;
    if (!this.endpoint) {
      this.root.add(
        new TextRenderable(renderer, { content: "No endpoint selected.", fg: C.red, paddingLeft: 2, paddingTop: 2 }),
      );
      this.app.openDashboard();
      return;
    }

    this.root.add(
      headerBar(
        renderer,
        "💬 Interactive chat",
        `${this.endpoint.name} · ${this.endpoint.model} · ${this.endpoint.provider}`,
      ),
    );

    const main = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1, width: "100%", gap: 1, padding: 1, minHeight: 0 });

    // Conversation
    const chatPanel = panel(renderer, {
      title: " Session — watch tokens stream in ",
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      titleColor: C.cyan,
    });
    this.scroll = new ScrollBoxRenderable(renderer, {
      width: "100%",
      height: "100%",
      stickyScroll: true,
      stickyStart: "bottom",
      scrollbarOptions: { trackOptions: { foregroundColor: C.border } },
    });
    this.addBanner();
    chatPanel.add(this.scroll);
    main.add(chatPanel);

    // Right column
    const right = new BoxRenderable(renderer, { flexDirection: "column", width: 44, gap: 1, minHeight: 0 });
    const metricsPanel = panel(renderer, { title: " Live metrics ", width: 44, flexGrow: 1, titleColor: C.yellow });
    this.metrics = new LiveMetricsPanel(renderer, this.endpoint.pricing);
    metricsPanel.add(this.metrics.box);

    const turnsPanel = panel(renderer, { title: " Turn TTFT (in this session) ", width: 44, height: 5, titleColor: C.dim });
    this.turnsText = new TextRenderable(renderer, { content: "—", fg: C.text });
    turnsPanel.add(this.turnsText);

    const sessionPanel = panel(renderer, { title: " Session totals ", width: 44, height: 6, titleColor: C.green });
    this.sessionText = new TextRenderable(renderer, { content: "", fg: C.text });
    sessionPanel.add(this.sessionText);

    addAll(right, metricsPanel, turnsPanel, sessionPanel);
    main.add(right);
    this.root.add(main);

    // Input row
    const inputRow = new BoxRenderable(renderer, {
      flexDirection: "row",
      width: "100%",
      paddingLeft: 1,
      paddingRight: 1,
      paddingBottom: 1,
      gap: 1,
      alignItems: "center",
    });
    const inputFrame = new BoxRenderable(renderer, {
      flexDirection: "row",
      flexGrow: 1,
      alignItems: "center",
      gap: 1,
      borderStyle: "rounded",
      borderColor: C.border,
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: "#11151C",
    });
    this.input = new InputRenderable(renderer, {
      flexGrow: 1,
      placeholder: "Ask anything… (Enter sends, Esc aborts)",
      backgroundColor: "transparent",
      focusedBackgroundColor: "transparent",
      textColor: C.text,
      cursorColor: C.accent,
    });
    this.input.on(InputRenderableEvents.ENTER, () => this.send());
    this.input.on(RenderableEvents.FOCUSED, () => {
      inputFrame.borderColor = C.accent;
    });
    this.input.on(RenderableEvents.BLURRED, () => {
      inputFrame.borderColor = C.border;
    });
    this.statusText = new TextRenderable(renderer, { content: "ready", fg: C.dim, width: 34, height: 1 });
    addAll(
      inputFrame,
      new TextRenderable(renderer, { content: "> ", fg: C.accent, attributes: 1, height: 1 }),
      this.input,
      this.statusText,
    );
    inputRow.add(inputFrame);
    this.root.add(inputRow);
    this.root.add(
      hintBar(renderer, [
        { key: "↵", label: "send" },
        { key: "esc", label: "abort / back" },
        { key: "Ctrl+X", label: "new session" },
      ]),
    );

    this.input.focus();
    this.renderTurns();
    this.renderSession();
  }

  private addBanner(): void {
    const banner = new BoxRenderable(this.renderer, {
      width: "100%",
      padding: 1,
      borderStyle: "single",
      borderColor: C.border,
      backgroundColor: C.panelAlt,
      marginBottom: 1,
    });
    banner.add(
      new TextRenderable(this.renderer, {
        content:
          "This chat talks to the selected endpoint with tool calling enabled.\n" +
          "Per-message TTFT, tokens/sec, cache reads and cost are tracked live.\n" +
          "If the model calls a tool, it is executed and the reply TTFT is measured.",
        fg: C.dim,
      }),
    );
    this.scroll.add(banner);
  }

  // -------------------------------------------------------------------------

  private send(): void {
    const text = this.input.value.trim();
    if (!text || this.streaming) return;
    this.input.value = "";
    this.turns.push({ role: "user", content: text });
    this.addUserBubble(text);
    this.toolRounds = 0;
    void this.agentLoop();
  }

  private async agentLoop(): Promise<void> {
    this.streaming = true;
    this.app.busy = true;
    this.statusText.content = "thinking…";
    try {
      await this.runTurn();
      while (this.streaming && this.lastTurnHasTools() && this.toolRounds < MAX_TOOL_ROUNDS) {
        this.toolRounds++;
        this.executeToolsAndRender();
        this.statusText.content = `tool round ${this.toolRounds}/${MAX_TOOL_ROUNDS} — waiting for reply…`;
        await this.runTurn();
      }
      if (this.lastTurnHasTools() && this.toolRounds >= MAX_TOOL_ROUNDS) {
        this.statusText.content = "stopped after max tool rounds.";
      } else {
        this.statusText.content = "ready";
      }
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        this.statusText.content = "aborted by user.";
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        this.statusText.content = `✖ ${msg}`;
        this.statusText.fg = C.red;
        this.addErrorBubble(msg);
      }
    } finally {
      this.streaming = false;
      this.app.busy = false;
      this.abortController = null;
      // Keep the last turn's metrics visible (phase "done") instead of wiping them.
      this.renderSession();
      this.input.focus();
    }
  }

  private lastTurnHasTools(): boolean {
    const last = this.turns[this.turns.length - 1];
    return !!last && last.role === "assistant" && (last.toolCalls?.length ?? 0) > 0;
  }

  private async runTurn(): Promise<void> {
    const { renderer } = this;
    const started = performance.now();
    let ttftMs: number | null = null;
    let text = "";
    let reasoningText = "";
    let usage: Usage | null = null;
    let stopReason: string | undefined;
    const toolCalls: ToolCallInfo[] = [];
    let currentToolPartial: ToolCallInfo | null = null;
    let aborted = false;

    // Assistant bubble: optional thinking box + content markdown
    const bubble = new BoxRenderable(renderer, { width: "100%", paddingBottom: 1, paddingTop: 1, flexDirection: "column" });
    const thinkingBox = new BoxRenderable(renderer, {
      flexDirection: "column",
      width: "100%",
      borderStyle: "single",
      borderColor: C.faint,
      backgroundColor: C.panelAlt,
      padding: 1,
      marginBottom: 1,
      visible: false,
    });
    const thinkingTag = new TextRenderable(renderer, { content: "🧠 thinking…", fg: C.dim, attributes: 1 });
    const thinkingMd = new MarkdownRenderable(renderer, {
      content: "",
      syntaxStyle: thinkingMarkdownStyle,
      streaming: true,
      width: "100%",
    });
    addAll(thinkingBox, thinkingTag, thinkingMd);
    bubble.add(thinkingBox);

    const roleTag = new TextRenderable(renderer, { content: "assistant  ", fg: C.cyan, attributes: 1 });
    const md = new MarkdownRenderable(renderer, {
      content: "",
      syntaxStyle: markdownStyle,
      streaming: true,
      width: "100%",
    });
    addAll(bubble, roleTag, md);
    this.scroll.add(bubble);

    const abortController = new AbortController();
    this.abortController = abortController;

    const messages = this.buildMessages();

    const flushThinking = (force = false) => {
      const now = performance.now();
      if (!force && now - this.lastMdFlush < MARKDOWN_FLUSH_MS) return;
      this.lastMdFlush = now;
      if (reasoningText) {
        thinkingBox.visible = true;
        thinkingMd.content += reasoningText;
        reasoningText = "";
      }
    };

    const flushMd = (force = false) => {
      const now = performance.now();
      if (!force && now - this.lastMdFlush < MARKDOWN_FLUSH_MS) return;
      this.lastMdFlush = now;
      if (text) md.content += text;
      text = "";
    };

    const contentLength = () => md.content.length + text.length;
    const updateMetrics = (phase: "connecting" | "streaming" | "done", force = false) => {
      const now = performance.now();
      if (!force && now - this.lastMetrics < METRICS_FLUSH_MS) return;
      this.lastMetrics = now;
      const elapsed = now - started;
      const est = Math.max(1, Math.ceil(contentLength() / 4));
      const streamTime = ttftMs != null ? elapsed - ttftMs : 0;
      this.metrics.update({
        phase,
        elapsedMs: elapsed,
        ttftMs,
        headersMs: null,
        chars: contentLength(),
        estTokens: est,
        tokPerSec: streamTime > 100 ? est / (streamTime / 1000) : null,
        usage,
      });
    };

    let streamError: unknown = null;
    try {
      await this.client.stream(
        {
          messages,
          tools: TOOLS,
          maxTokens: 2048,
          temperature: this.endpoint.temperature ?? undefined,
          useCache: this.endpoint.provider === "anthropic",
        },
        {
          onHeaders: () => updateMetrics("connecting"),
          onFirstToken: (ms) => {
            ttftMs = ms;
            this.statusText.content = "thinking…";
            updateMetrics("streaming", true);
          },
          onReasoningDelta: (d) => {
            reasoningText += d;
            this.statusText.content = "thinking…";
            flushThinking();
            updateMetrics("streaming");
          },
          onDelta: (d) => {
            // First content token: reasoning phase is over — finalize the thinking box.
            if (!this.thinkingFinalized) {
              this.thinkingFinalized = true;
              thinkingMd.streaming = false;
              thinkingTag.content = "🧠 thought";
            }
            this.statusText.content = "streaming…";
            text += d;
            flushMd();
            updateMetrics("streaming");
          },
          onToolCall: (tc) => {
            if (tc.id) {
              const idx = toolCalls.findIndex((t) => t.id === tc.id);
              if (idx >= 0) toolCalls[idx] = tc;
              else toolCalls.push(tc);
            } else {
              currentToolPartial = tc;
            }
            this.statusText.content = `calling tool: ${tc.name || "…"}`;
            updateMetrics("streaming");
          },
          onUsage: (u, sr) => {
            usage = u;
            if (sr) stopReason = sr;
            updateMetrics("streaming");
          },
        },
        abortController.signal,
      );
    } catch (err) {
      streamError = err;
      if (abortController.signal.aborted) aborted = true;
    }

    flushThinking(true);
    flushMd(true);
    thinkingMd.streaming = false;
    md.streaming = false;

    if (streamError && !aborted) {
      this.metrics.update({ phase: "error", elapsedMs: performance.now() - started, ttftMs, headersMs: null, chars: md.content.length, estTokens: 0, tokPerSec: null, usage: null });
      throw streamError;
    }

    usage ??= { ...EMPTY_USAGE };
    const durationMs = performance.now() - started;
    const streamTime = ttftMs != null ? durationMs - ttftMs : durationMs;
    const tokensPerSec = usage.outputTokens > 0 && streamTime > 0 ? usage.outputTokens / (streamTime / 1000) : null;
    const reasoningLen = thinkingMd.content.length;

    const turn: TurnMetrics = {
      label: this.toolRounds === 0 ? "reply" : `reply (after tool)`,
      ttftMs,
      headersMs: null,
      durationMs,
      outputTokens: usage.outputTokens,
      inputTokens: usage.inputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      tokensPerSec,
      cost: computeCost(this.endpoint.pricing, usage),
      charCount: md.content.length,
      reasoningTokens: reasoningLen > 0 ? Math.max(1, Math.ceil(reasoningLen / 4)) : undefined,
      toolCalls: toolCalls.map((t) => ({ ...t })),
      stopReason,
      note: aborted ? "aborted" : undefined,
    };

    // Merge tool calls accumulated from callbacks
    if (toolCalls.length === 0 && currentToolPartial) toolCalls.push(currentToolPartial);

    this.turns.push({
      role: "assistant",
      content: md.content,
      reasoning: thinkingMd.content.length > 0 ? thinkingMd.content : undefined,
      toolCalls: toolCalls.map((t) => ({ ...t })),
    });
    this.turnTtfts.push({
      label: this.toolRounds === 0 ? "assistant" : `assistant (after tool)`,
      ttft: ttftMs,
      kind: "tool",
      ok: !aborted,
    });
    this.accumulate(usage, turn.cost);
    this.sessionReasoningChars += reasoningLen;

    this.metrics.update(
      {
        phase: aborted ? "error" : "done",
        elapsedMs: durationMs,
        ttftMs,
        headersMs: null,
        chars: md.content.length,
        estTokens: usage.outputTokens,
        tokPerSec: tokensPerSec,
        usage,
      },
    );
    this.renderTurns();
    this.renderSession();

    if (aborted) {
      this.statusText.content = "aborted.";
      throw new Error("aborted");
    }
  }

  private executeToolsAndRender(): void {
    const last = this.turns[this.turns.length - 1];
    if (!last || last.role !== "assistant") return;
    const results = (last.toolCalls ?? []).map((tc) => ({
      toolCallId: tc.id,
      content: executeTool(tc.name, this.parseArgs(tc.input)),
    }));
    for (const r of results) {
      this.addToolBubble(
        last.toolCalls?.find((tc) => tc.id === r.toolCallId),
        r.content,
      );
    }
    this.turns.push({ role: "tool", content: "", toolResults: results });
    this.renderSession();
  }

  private parseArgs(input: string): unknown {
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }

  private buildMessages(): ChatMsg[] {
    const msgs: ChatMsg[] = [];
    for (const t of this.turns) {
      if (t.role === "user") msgs.push({ role: "user", content: t.content });
      else if (t.role === "assistant") msgs.push({ role: "assistant", content: t.content, toolCalls: t.toolCalls });
      else if (t.role === "tool") msgs.push({ role: "tool", content: "", toolResults: t.toolResults });
    }
    return msgs;
  }

  private accumulate(usage: Usage, cost: number): void {
    this.sessionUsage.inputTokens += usage.inputTokens;
    this.sessionUsage.outputTokens += usage.outputTokens;
    this.sessionUsage.cacheReadTokens += usage.cacheReadTokens;
    this.sessionUsage.cacheWriteTokens += usage.cacheWriteTokens;
    this.sessionCost += cost;
  }

  // -------------------------------------------------------------------------
  // Rendering helpers

  private addUserBubble(content: string): void {
    const bubble = new BoxRenderable(this.renderer, {
      width: "100%",
      paddingBottom: 1,
      paddingTop: 1,
      flexDirection: "row",
      gap: 1,
    });
    addAll(bubble, new TextRenderable(this.renderer, { content: "you  ", fg: C.green, attributes: 1 }), new TextRenderable(this.renderer, { content, fg: C.text }));
    this.scroll.add(bubble);
  }

  private addToolBubble(tool: ToolCallInfo | undefined, result: string): void {
    const bubble = new BoxRenderable(this.renderer, {
      width: "100%",
      padding: 1,
      paddingBottom: 1,
      marginTop: 1,
      marginBottom: 1,
      borderStyle: "single",
      borderColor: C.purple,
      backgroundColor: C.panelAlt,
      flexDirection: "column",
      gap: 1,
    });
    const name = tool ? `${tool.name}(${tool.input})` : "tool";
    addAll(
      bubble,
      new TextRenderable(this.renderer, { content: `⚙ ${name}`, fg: C.purple, attributes: 1 }),
      new TextRenderable(this.renderer, { content: `→ ${result}`, fg: C.dim, flexShrink: 1 }),
    );
    this.scroll.add(bubble);
  }

  private addErrorBubble(msg: string): void {
    const bubble = new BoxRenderable(this.renderer, { width: "100%", padding: 1, marginTop: 1 });
    bubble.add(new TextRenderable(this.renderer, { content: `✖ ${msg}`, fg: C.red }));
    this.scroll.add(bubble);
  }

  private renderTurns(): void {
    const lines = this.turnTtfts.map((t) => {
      const mark = t.ok ? "✓" : "✖";
      const ttft = t.ttft != null ? fmtMs(t.ttft) : "—";
      return `${mark} ${t.label}: ${ttft}`;
    });
    this.turnsText.content = lines.length === 0 ? "—" : lines.slice(-6).join("\n");
  }

  private renderSession(): void {
    const u = this.sessionUsage;
    const totalIn = Math.max(u.inputTokens, u.cacheReadTokens + u.cacheWriteTokens);
    const cachePct = totalIn > 0 ? u.cacheReadTokens / totalIn : 0;
    const thinking = this.sessionReasoningChars > 0 ? fmtNum(Math.ceil(this.sessionReasoningChars / 4), 0) : null;
    this.sessionText.content =
      `messages  : ${this.turns.length}\n` +
      `input     : ${fmtNum(u.inputTokens, 0)} tokens\n` +
      `output    : ${fmtNum(u.outputTokens, 0)} tokens\n` +
      (thinking ? `thinking  : ${thinking} tokens (est)\n` : ``) +
      `cache     : ${fmtNum(u.cacheReadTokens, 0)} read / ${fmtNum(u.cacheWriteTokens, 0)} written  (${fmtPct(cachePct)} of prompt)\n` +
      `total cost: ${fmtCost(this.sessionCost)}`;
  }

  // -------------------------------------------------------------------------

  override onKey(key: import("@opentui/core").KeyEvent): void {
    if (key.name === "escape") {
      if (this.streaming) {
        this.abortController?.abort();
        this.statusText.content = "aborting…";
      } else {
        this.app.openDashboard();
      }
      return;
    }
    if (key.ctrl && key.name === "x") {
      this.newSession();
    }
    if (key.ctrl && key.name === "l") {
      // Clear the conversation view but keep history (simple scroll reset)
      this.scroll.scrollTo({ x: 0, y: this.scroll.scrollHeight });
    }
  }

  private newSession(): void {
    if (this.streaming) this.abortController?.abort();
    // Recreate the screen for a clean slate
    this.app.openChat(this.endpoint.id);
  }

  override onCtrlC(): void {
    if (this.streaming) {
      this.abortController?.abort();
      this.statusText.content = "aborting…";
    } else {
      this.app.quit();
    }
  }
}