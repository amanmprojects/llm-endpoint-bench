// Persistent benchmark run history.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestKind, TestResult } from "./types.ts";
import { uuid } from "./format.ts";

export interface RunRecord {
  id: string;
  timestamp: number;
  endpointId: string;
  endpointLabel: string;
  provider: string;
  model: string;
  baseUrl: string;
  kinds: TestKind[];
  iterations: number;
  results: TestResult[];
  totalCost: number;
}

const MAX_RUNS = 100;

export class HistoryStore {
  runs: RunRecord[] = [];
  path = "";

  constructor() {
    const dir = process.env.LLM_BENCH_CONFIG_DIR ?? join(process.env.HOME ?? "", ".llm-bench");
    this.path = join(dir, "history.json");
  }

  load(): void {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as { runs?: RunRecord[] };
      if (parsed && Array.isArray(parsed.runs)) {
        this.runs = parsed.runs.filter(isRun).sort((a, b) => b.timestamp - a.timestamp);
      }
    } catch {
      this.runs = [];
    }
  }

  add(record: Omit<RunRecord, "id" | "timestamp">): RunRecord {
    const run: RunRecord = {
      id: uuid(),
      timestamp: Date.now(),
      ...record,
    };
    this.runs.unshift(run);
    if (this.runs.length > MAX_RUNS) this.runs = this.runs.slice(0, MAX_RUNS);
    this.save();
    return run;
  }

  remove(id: string): void {
    this.runs = this.runs.filter((r) => r.id !== id);
    this.save();
  }

  clear(): void {
    this.runs = [];
    this.save();
  }

  private save(): void {
    try {
      mkdirSync(join(this.path, ".."), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ version: 1, runs: this.runs }, null, 2), "utf8");
    } catch (err) {
      console.error("failed to save history:", err);
    }
  }
}

function isRun(r: unknown): r is RunRecord {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.timestamp === "number" &&
    typeof o.endpointLabel === "string" &&
    Array.isArray(o.results)
  );
}
