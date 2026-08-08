// Persistent endpoint configuration.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Endpoint } from "./types.ts";
import { uuid } from "./format.ts";
import { defaultPricingForModel } from "./pricing.ts";

export interface ConfigFile {
  version: number;
  endpoints: Endpoint[];
}

const CONFIG_DIR = process.env.LLM_BENCH_CONFIG_DIR ?? join(homedir(), ".llm-bench");
const CONFIG_PATH = join(CONFIG_DIR, "endpoints.json");

export class ConfigStore {
  endpoints: Endpoint[] = [];
  path = CONFIG_PATH;

  load(): Endpoint[] {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<ConfigFile>;
      if (parsed && Array.isArray(parsed.endpoints)) {
        this.endpoints = parsed.endpoints.filter(isValidEndpoint);
      }
    } catch {
      this.endpoints = [];
    }
    return this.endpoints;
  }

  save(): void {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const file: ConfigFile = { version: 1, endpoints: this.endpoints };
    writeFileSync(this.path, JSON.stringify(file, null, 2), "utf8");
  }

  upsert(endpoint: Endpoint): void {
    const idx = this.endpoints.findIndex((e) => e.id === endpoint.id);
    if (idx >= 0) this.endpoints[idx] = endpoint;
    else this.endpoints.push(endpoint);
    this.save();
  }

  remove(id: string): void {
    this.endpoints = this.endpoints.filter((e) => e.id !== id);
    this.save();
  }

  get(id: string | null): Endpoint | undefined {
    if (!id) return undefined;
    return this.endpoints.find((e) => e.id === id);
  }
}

function isValidEndpoint(e: unknown): e is Endpoint {
  if (typeof e !== "object" || e === null) return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    (o.provider === "openai" || o.provider === "anthropic") &&
    typeof o.baseUrl === "string" &&
    typeof o.apiKey === "string" &&
    typeof o.model === "string" &&
    typeof o.pricing === "object" &&
    o.pricing !== null
  );
}

export function newEndpoint(partial: Partial<Endpoint> = {}): Endpoint {
  const model = partial.model ?? "gpt-4o";
  const provider = partial.provider ?? "openai";
  return {
    id: partial.id ?? uuid(),
    name: partial.name ?? model,
    provider,
    baseUrl: partial.baseUrl ?? (provider === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
    apiKey: partial.apiKey ?? "",
    model,
    pricing: partial.pricing ?? defaultPricingForModel(model),
    temperature: partial.temperature ?? null,
  };
}

/** Resolve a display key (masked, e.g. sk-…abc) for the UI. */
export function maskKey(key: string): string {
  if (!key) return "(not set)";
  if (key.startsWith("env:")) return key;
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
