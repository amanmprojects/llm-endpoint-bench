// Small reusable UI building blocks.
import { BoxRenderable, TextRenderable, type CliRenderer, type Renderable } from "@opentui/core";
import { C } from "./theme.ts";

/** Add multiple children (OpenTUI's add() takes one child + optional index). */
export function addAll(box: BoxRenderable, ...children: Renderable[]): void {
  for (const c of children) box.add(c);
}

export interface LabeledValue {
  box: BoxRenderable;
  valueText: TextRenderable;
  set(value: string, fg?: string): void;
}

/** A single "Label  value" row. */
export function labeledValue(renderer: CliRenderer, label: string, value = "—", valueFg: string = C.text): LabeledValue {
  const box = new BoxRenderable(renderer, {
    flexDirection: "row",
    width: "100%",
    gap: 1,
  });
  const labelText = new TextRenderable(renderer, { content: label.padEnd(12), fg: C.dim });
  const valueText = new TextRenderable(renderer, { content: value, fg: valueFg, flexShrink: 1 });
  addAll(box, labelText, valueText);
  return {
    box,
    valueText,
    set(v: string, fg: string = valueFg) {
      valueText.content = v;
      valueText.fg = fg;
    },
  };
}

export function headerBar(renderer: CliRenderer, title: string, subtitle: string): BoxRenderable {
  const bar = new BoxRenderable(renderer, {
    flexDirection: "row",
    width: "100%",
    height: 3,
    paddingLeft: 2,
    paddingRight: 2,
    alignItems: "center",
    justifyContent: "space-between",
    borderStyle: "single",
    borderColor: C.border,
    backgroundColor: C.panel,
  });
  addAll(
    bar,
    new TextRenderable(renderer, { content: title, fg: C.accent, attributes: 1 /* bold */ }),
    new TextRenderable(renderer, { content: subtitle, fg: C.dim }),
  );
  return bar;
}

export interface HintItem {
  key: string;
  label: string;
}

/** Bottom keybinding hint bar. */
export function hintBar(renderer: CliRenderer, hints: HintItem[], right?: string): BoxRenderable {
  const bar = new BoxRenderable(renderer, {
    flexDirection: "row",
    width: "100%",
    height: 1,
    paddingLeft: 1,
    paddingRight: 1,
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.panel,
  });
  const left = new BoxRenderable(renderer, { flexDirection: "row", gap: 2 });
  for (const h of hints) {
    addAll(
      left,
      new TextRenderable(renderer, { content: `${h.key} `, fg: C.accent, attributes: 1 }),
      new TextRenderable(renderer, { content: h.label, fg: C.dim }),
    );
  }
  bar.add(left);
  if (right) bar.add(new TextRenderable(renderer, { content: right, fg: C.faint }));
  return bar;
}

type Width = number | "auto" | `${number}%`;
type Height = number | "auto" | `${number}%`;

/** A bordered panel with a title. */
export function panel(
  renderer: CliRenderer,
  opts: {
    title?: string;
    flexGrow?: number;
    flexShrink?: number;
    minWidth?: number;
    minHeight?: number;
    height?: number | string;
    width?: number | string;
    titleColor?: string;
    borderColor?: string;
  },
): BoxRenderable {
  const width: Width = (typeof opts.width === "number" ? opts.width : (opts.width ?? "100%")) as Width;
  const height: Height | undefined = (opts.height ?? undefined) as Height | undefined;
  return new BoxRenderable(renderer, {
    flexDirection: "column",
    width,
    height,
    flexGrow: opts.flexGrow ?? 0,
    flexShrink: opts.flexShrink ?? 0,
    minWidth: opts.minWidth,
    minHeight: opts.minHeight,
    borderStyle: "rounded",
    borderColor: opts.borderColor ?? C.border,
    title: opts.title,
    titleColor: opts.titleColor ?? C.dim,
    padding: 1,
    backgroundColor: C.panel,
  });
}

export function divider(renderer: CliRenderer, width: number | string = "100%"): BoxRenderable {
  return new BoxRenderable(renderer, { width: width as Width, height: 1, backgroundColor: C.border });
}
