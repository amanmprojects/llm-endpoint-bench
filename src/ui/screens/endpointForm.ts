// Endpoint add/edit form.
import { BoxRenderable, InputRenderable, InputRenderableEvents, SelectRenderable, TextRenderable } from "@opentui/core";
import type { App } from "../app.ts";
import { BaseScreen } from "../screen.ts";
import { C } from "../theme.ts";
import { headerBar, hintBar, addAll, panel } from "../components.ts";
import { newEndpoint } from "../../core/config.ts";
import { defaultPricingForModel } from "../../core/pricing.ts";
import type { Endpoint, ProviderType } from "../../core/types.ts";

export class EndpointFormScreen extends BaseScreen {
  readonly root: BoxRenderable;
  private fields: Array<InputRenderable | SelectRenderable> = [];
  private formBox!: BoxRenderable;
  private errorText!: TextRenderable;

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
    const { renderer, app } = this;
    const existing = app.getEndpoint(this.endpointId);
    const seed = existing ?? newEndpoint({ provider: app.endpoints.length === 0 ? "openai" : app.endpoints[0]?.provider });

    this.root.add(headerBar(renderer, existing ? "✏️ Edit endpoint" : "➕ New endpoint", existing ? existing.name : "llm-bench"));

    const wrap = new BoxRenderable(renderer, {
      flexGrow: 1,
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      padding: 2,
    });

    this.formBox = panel(renderer, { title: " Endpoint settings ", width: 74, titleColor: C.accent });

    const nameInput = this.makeInput("Name", seed.name, "e.g. prod-openai");
    const providerSelect = this.makeProviderSelect(seed.provider);
    const urlInput = this.makeInput("Base URL", seed.baseUrl, "https://api.openai.com/v1");
    const keyInput = this.makeInput("API key", seed.apiKey, "sk-… or env:MY_KEY (leave empty if none)");
    const modelInput = this.makeInput("Model", seed.model, "gpt-4o / claude-sonnet-4-…");
    const tempInput = this.makeInput("Temperature", seed.temperature != null ? String(seed.temperature) : "", "blank = provider default");
    const inInput = this.makeInput("$ input /1M", String(seed.pricing.input));
    const outInput = this.makeInput("$ output /1M", String(seed.pricing.output));
    const crInput = this.makeInput("$ cache read /1M", String(seed.pricing.cacheRead));
    const cwInput = this.makeInput("$ cache write /1M", String(seed.pricing.cacheWrite));

    this.fields = [nameInput, providerSelect, urlInput, keyInput, modelInput, tempInput, inInput, outInput, crInput, cwInput];

    const grid = new BoxRenderable(renderer, { flexDirection: "column", gap: 1, width: "100%" });
    addAll(grid, this.row(renderer, "Name", nameInput), this.row(renderer, "Provider", providerSelect), this.row(renderer, "Base URL", urlInput), this.row(renderer, "API key", keyInput), this.row(renderer, "Model", modelInput), this.row(renderer, "Temperature", tempInput));
    const priceRow = new BoxRenderable(renderer, { flexDirection: "row", gap: 2, width: "100%", paddingLeft: 14 });
    addAll(priceRow, this.priceCell(renderer, "input", inInput), this.priceCell(renderer, "output", outInput));
    const priceRow2 = new BoxRenderable(renderer, { flexDirection: "row", gap: 2, width: "100%", paddingLeft: 14 });
    addAll(priceRow2, this.priceCell(renderer, "cache read", crInput), this.priceCell(renderer, "cache write", cwInput));

    addAll(grid, new TextRenderable(renderer, { content: "Pricing (USD per 1,000,000 tokens) — used for cost reporting.", fg: C.dim }), priceRow, priceRow2);

    this.errorText = new TextRenderable(renderer, { content: "", fg: C.red });

    const buttonRow = new BoxRenderable(renderer, { flexDirection: "row", gap: 3, paddingTop: 1 });
    addAll(
      buttonRow,
      new TextRenderable(renderer, { content: " [Ctrl+S] save ", fg: C.green }),
      new TextRenderable(renderer, { content: " [Esc] cancel ", fg: C.red }),
      new TextRenderable(renderer, { content: " [Tab] next field   [Ctrl+R] autofill pricing   [↑/↓] provider (when focused)", fg: C.faint }),
    );

    addAll(this.formBox, grid, this.errorText, buttonRow);
    wrap.add(this.formBox);
    this.root.add(wrap);
    this.root.add(hintBar(renderer, [{ key: "Ctrl+S", label: "save" }, { key: "Esc", label: "cancel" }, { key: "Tab", label: "next field" }]));

    nameInput.focus();
  }

  private makeInput(label: string, value: string, placeholder = ""): InputRenderable {
    const input = new InputRenderable(this.renderer, {
      width: 48,
      value,
      placeholder,
      backgroundColor: "#11151C",
      focusedBackgroundColor: "#1C2530",
      textColor: C.text,
      cursorColor: C.accent,
    });
    return input;
  }

  private makeProviderSelect(provider: ProviderType): SelectRenderable {
    const select = new SelectRenderable(this.renderer, {
      width: 48,
      height: 3,
      options: [
        { name: "openai", description: "OpenAI-compatible /chat/completions (OpenAI, vLLM, Ollama, …)" },
        { name: "anthropic", description: "Anthropic Messages API" },
      ],
      selectedIndex: provider === "anthropic" ? 1 : 0,
      selectedBackgroundColor: C.panelAlt,
      selectedTextColor: C.accent,
      textColor: C.text,
      descriptionColor: C.dim,
      showScrollIndicator: false,
      showSelectionIndicator: false,
    });
    return select;
  }

  private row(renderer: App["renderer"], label: string, field: InputRenderable | SelectRenderable): BoxRenderable {
    const row = new BoxRenderable(this.renderer, { flexDirection: "row", gap: 1, width: "100%", alignItems: "center" });
    addAll(row, new TextRenderable(this.renderer, { content: label.padEnd(13), fg: C.dim }), field);
    return row;
  }

  private priceCell(renderer: App["renderer"], label: string, input: InputRenderable): BoxRenderable {
    const cell = new BoxRenderable(this.renderer, { flexDirection: "row", gap: 1, alignItems: "center" });
    addAll(cell, new TextRenderable(this.renderer, { content: `${label}:`, fg: C.dim }), input);
    return cell;
  }

  private currentProvider(): ProviderType {
    const p = this.fields[1];
    if (p instanceof SelectRenderable) {
      return p.getSelectedIndex() === 1 ? "anthropic" : "openai";
    }
    return "openai";
  }

  private save(): void {
    const [name, _provider, url, key, model, temp, inP, outP, crP, cwP] = this.fields as [
      InputRenderable,
      SelectRenderable,
      InputRenderable,
      InputRenderable,
      InputRenderable,
      InputRenderable,
      InputRenderable,
      InputRenderable,
      InputRenderable,
      InputRenderable,
    ];

    const baseUrl = url.value.trim();
    const modelName = model.value.trim();
    const errors: string[] = [];
    if (!baseUrl) errors.push("Base URL is required");
    else if (!/^https?:\/\//i.test(baseUrl)) errors.push("Base URL must start with http:// or https://");
    if (!modelName) errors.push("Model is required");

    const nums: number[] = [];
    for (const f of [inP, outP, crP, cwP]) {
      const v = parseFloat(f.value);
      if (Number.isFinite(v) && v >= 0) nums.push(v);
      else nums.push(0);
    }
    const [pIn, pOut, pCr, pCw] = nums as [number, number, number, number];

    if (errors.length > 0) {
      this.errorText.content = `⚠ ${errors.join(" · ")}`;
      return;
    }

    const existing = this.app.getEndpoint(this.endpointId);
    const temperature = temp.value.trim() === "" ? null : Number(temp.value.trim());
    const endpoint: Endpoint = {
      id: existing?.id ?? crypto.randomUUID(),
      name: name.value.trim() || modelName,
      provider: this.currentProvider(),
      baseUrl,
      apiKey: key.value.trim(),
      model: modelName,
      pricing: { input: pIn, output: pOut, cacheRead: pCr, cacheWrite: pCw },
      temperature: temperature != null && Number.isFinite(temperature) ? temperature : null,
    };

    this.app.config.upsert(endpoint);
    this.app.refreshEndpoints();
    this.app.selectedEndpointId = endpoint.id;
    this.app.openDashboard();
  }

  override onKey(key: import("@opentui/core").KeyEvent): void {
    if (key.ctrl && key.name === "s") {
      this.save();
      return;
    }
    if (key.name === "escape") {
      this.app.openDashboard();
      return;
    }
    if (key.name === "tab") {
      const idx = this.fields.findIndex((f) => f.focused);
      const next = this.fields[(idx + 1) % this.fields.length];
      next?.focus();
    }
    if (key.ctrl && key.name === "r") {
      // autofill pricing from model name
      const [, , , , model] = this.fields as [InputRenderable, SelectRenderable, InputRenderable, InputRenderable, InputRenderable];
      const pricing = defaultPricingForModel(model.value.trim());
      (this.fields[6] as InputRenderable).value = String(pricing.input);
      (this.fields[7] as InputRenderable).value = String(pricing.output);
      (this.fields[8] as InputRenderable).value = String(pricing.cacheRead);
      (this.fields[9] as InputRenderable).value = String(pricing.cacheWrite);
      this.errorText.content = "Pricing auto-filled for model. Press Ctrl+S to save.";
    }
  }
}
