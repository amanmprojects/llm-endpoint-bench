import type { Pricing } from "./types.ts";

/** Default pricing presets (USD per 1M tokens) for well-known models. */
export function defaultPricingForModel(model: string): Pricing {
  const m = model.toLowerCase();
  const zero: Pricing = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  // OpenAI
  if (m.includes("gpt-4o-mini")) return { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 };
  if (m.includes("gpt-4o") || m.includes("chatgpt-4o")) return { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 };
  if (m.includes("gpt-4.1-mini")) return { input: 0.4, output: 1.6, cacheRead: 0.2, cacheWrite: 0.4 };
  if (m.includes("gpt-4.1-nano")) return { input: 0.1, output: 0.4, cacheRead: 0.05, cacheWrite: 0.1 };
  if (m.includes("gpt-4.1")) return { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 };
  if (m.includes("gpt-4-turbo")) return { input: 10, output: 30, cacheRead: 10, cacheWrite: 10 };
  if (m.includes("gpt-4")) return { input: 30, output: 60, cacheRead: 30, cacheWrite: 30 };
  if (m.includes("gpt-3.5-turbo")) return { input: 0.5, output: 1.5, cacheRead: 0.25, cacheWrite: 0.5 };
  if (m.includes("o1") || m.includes("o3") || m.includes("o4")) return { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 15 };
  if (m.includes("gpt-5")) return { input: 1.25, output: 10, cacheRead: 0.625, cacheWrite: 1.25 };

  // Anthropic
  if (m.includes("claude-opus") || m.includes("claude-3-opus") || m.includes("claude-4-opus")) {
    return { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 };
  }
  if (m.includes("claude-sonnet") || m.includes("claude-3.5-sonnet") || m.includes("claude-3-7-sonnet")) {
    return { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  }
  if (m.includes("claude-haiku") || m.includes("claude-3-haiku") || m.includes("claude-3-5-haiku")) {
    return { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };
  }

  // DeepSeek (official DeepSeek pricing; editable in the endpoint form)
  if (m.includes("deepseek-v4-flash")) return { input: 0.28, output: 0.42, cacheRead: 0.028, cacheWrite: 0.28 };
  if (m.includes("deepseek-v4") || m.includes("deepseek-chat")) return { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 };
  if (m.includes("deepseek-reasoner") || m.includes("deepseek-r1")) return { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 };

  // Kimi / Moonshot
  if (m.includes("kimi")) return { input: 0.6, output: 2.5, cacheRead: 0.06, cacheWrite: 0.6 };

  // GLM / Zhipu
  if (m.includes("glm")) return { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0.5 };

  // Qwen
  if (m.includes("qwen")) return { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.4 };

  // Grok / xAI
  if (m.includes("grok")) return { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 };

  return zero;
}

export const PRICING_FIELDS = [
  { key: "input", label: "Input /1M" },
  { key: "output", label: "Output /1M" },
  { key: "cacheRead", label: "Cache read /1M" },
  { key: "cacheWrite", label: "Cache write /1M" },
] as const;

export function computeCost(pricing: Pricing, u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
  return (
    (u.inputTokens * pricing.input +
      u.outputTokens * pricing.output +
      u.cacheReadTokens * pricing.cacheRead +
      u.cacheWriteTokens * pricing.cacheWrite) /
    1e6
  );
}

export function resolveApiKey(spec: string): string {
  const s = spec.trim();
  if (s.startsWith("env:")) {
    const name = s.slice(4).trim();
    const v = process.env[name];
    if (!v) throw new Error(`Environment variable ${name} is not set (referenced by apiKey "${s}")`);
    return v;
  }
  return s;
}
