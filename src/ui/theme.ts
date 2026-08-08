// Central color/theme definitions for the TUI.
import { SyntaxStyle, RGBA } from "@opentui/core";

export const C = {
  bg: "#0D1117",
  panel: "#161B22",
  panelAlt: "#1C2129",
  border: "#30363D",
  borderFocus: "#58A6FF",
  text: "#E6EDF3",
  dim: "#8B949E",
  faint: "#6E7681",
  accent: "#58A6FF",
  green: "#3FB950",
  greenDim: "#2EA043",
  yellow: "#D29922",
  orange: "#E39A3B",
  red: "#F85149",
  purple: "#BC8CFF",
  cyan: "#39C5CF",
  pink: "#DB61A2",
} as const;

export function syntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(C.text) },
    "markup.heading.1": { fg: RGBA.fromHex(C.accent), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex(C.accent), bold: true },
    "markup.heading.3": { fg: RGBA.fromHex(C.cyan), bold: true },
    "markup.list": { fg: RGBA.fromHex(C.purple) },
    "markup.bold": { fg: RGBA.fromHex(C.yellow), bold: true },
    "markup.italic": { fg: RGBA.fromHex(C.pink), italic: true },
    "markup.raw": { fg: RGBA.fromHex(C.cyan) },
    "markup.link": { fg: RGBA.fromHex(C.accent), underline: true },
    "markup.quote": { fg: RGBA.fromHex(C.dim), italic: true },
    "markup.strikethrough": { fg: RGBA.fromHex(C.dim) },
    "markup.inline": { fg: RGBA.fromHex(C.orange) },
    "markup.inline.raw": { fg: RGBA.fromHex(C.cyan) },
    "markup.table": { fg: RGBA.fromHex(C.dim) },
    "markup.code_block": { fg: RGBA.fromHex(C.text) },
    // code token colors
    keyword: { fg: RGBA.fromHex("#FF7B72") },
    string: { fg: RGBA.fromHex("#A5D6FF") },
    number: { fg: RGBA.fromHex("#79C0FF") },
    function: { fg: RGBA.fromHex("#D2A8FF") },
    type: { fg: RGBA.fromHex("#FFA657") },
    comment: { fg: RGBA.fromHex("#8B949E") },
    variable: { fg: RGBA.fromHex("#E6EDF3") },
    operator: { fg: RGBA.fromHex("#FF7B72") },
    property: { fg: RGBA.fromHex("#79C0FF") },
    constant: { fg: RGBA.fromHex("#79C0FF") },
    namespace: { fg: RGBA.fromHex("#FFC657") },
    punctuation: { fg: RGBA.fromHex("#E6EDF3") },
  });
}

/** Shared SyntaxStyle instance (safe to reuse). */
export const markdownStyle = syntaxStyle();

/** Muted style for reasoning/thinking tokens — visually distinct from the answer. */
export function thinkingStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex("#9DA7B3"), italic: true },
    "markup.heading.1": { fg: RGBA.fromHex("#8B949E"), bold: true, italic: true },
    "markup.heading.2": { fg: RGBA.fromHex("#8B949E"), bold: true, italic: true },
    "markup.heading.3": { fg: RGBA.fromHex("#8B949E"), bold: true, italic: true },
    "markup.list": { fg: RGBA.fromHex("#8B949E"), italic: true },
    "markup.bold": { fg: RGBA.fromHex("#8B949E"), bold: true, italic: true },
    "markup.raw": { fg: RGBA.fromHex("#8B949E"), italic: true },
    "markup.quote": { fg: RGBA.fromHex("#8B949E"), italic: true },
    "markup.inline": { fg: RGBA.fromHex("#8B949E"), italic: true },
    "markup.inline.raw": { fg: RGBA.fromHex("#8B949E"), italic: true },
    keyword: { fg: RGBA.fromHex("#8B949E"), italic: true },
    string: { fg: RGBA.fromHex("#8B949E"), italic: true },
    number: { fg: RGBA.fromHex("#8B949E"), italic: true },
    comment: { fg: RGBA.fromHex("#6E7681"), italic: true },
    variable: { fg: RGBA.fromHex("#9DA7B3"), italic: true },
    operator: { fg: RGBA.fromHex("#8B949E"), italic: true },
    punctuation: { fg: RGBA.fromHex("#8B949E"), italic: true },
  });
}

export const thinkingMarkdownStyle = thinkingStyle();

export function statusColor(status: "ok" | "error" | "running" | "idle"): string {
  switch (status) {
    case "ok":
      return C.green;
    case "error":
      return C.red;
    case "running":
      return C.yellow;
    default:
      return C.dim;
  }
}
