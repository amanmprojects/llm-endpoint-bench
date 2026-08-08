// Formatting helpers for metrics, costs, tokens, etc.

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

/** USD cost with a $ prefix and sensible significant digits. */
export function fmtCost(cost: number | null | undefined): string {
  if (cost == null || !Number.isFinite(cost)) return "—";
  if (cost === 0) return "$0.00";
  const abs = Math.abs(cost);
  let s: string;
  if (abs >= 1000) s = cost.toFixed(2);
  else if (abs >= 1) s = cost.toFixed(3);
  else if (abs >= 0.01) s = cost.toFixed(4);
  else if (abs >= 0.0001) s = cost.toFixed(6);
  else s = cost.toExponential(2);
  return `$${s}`;
}

export function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(1)}%`;
}

/** Estimate tokens from character count (crude, used live before real usage arrives). */
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/** Render a token-rate sparkline from a series of samples. */
export function sparkline(samples: number[], width: number): string {
  if (samples.length === 0) return "·".repeat(Math.max(1, width));
  const window = samples.slice(-width);
  const max = Math.max(...window, 1);
  const out: string[] = [];
  for (const s of window) {
    const idx = Math.min(SPARK.length - 1, Math.floor((s / max) * SPARK.length));
    out.push(SPARK[idx] ?? "█");
  }
  return out.join("");
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + "…";
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
