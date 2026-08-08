# ⚡ llm-bench — LLM endpoint benchmark & quality tester

A terminal app that measures how good an LLM endpoint actually **feels**: time-to-first-token,
tokens/sec, prompt caching, tool-call latency, token usage and cost — with a live chat view
so you can watch tokens stream in exactly as a real user would experience them.

Built with [OpenTUI](https://github.com/anomalyco/opentui) on Bun. Works with **any
OpenAI-compatible API** (OpenAI, vLLM, Ollama, LM Studio, Groq, Together, OpenRouter, custom
gateways…) and the **Anthropic Messages API** (or compatible proxies).

---

## Quick start

```sh
bun install
bun src/index.ts
```

Press `n` to add your endpoint:

| Field | Example |
| --- | --- |
| Provider | `openai` (OpenAI-compatible) or `anthropic` |
| Base URL | `https://opencode.ai/zen/go/v1` or `https://api.anthropic.com/v1` |
| API key | literal key, or `env:MY_VAR` to read from the environment |
| Model | `deepseek-v4-flash`, `gpt-4o`, `claude-sonnet-4-…` |
| Pricing | USD per 1M tokens (auto-filled for known models with `Ctrl+R`) |
| Temperature | blank = provider default (some models reject explicit temps) |

Config is stored in `~/.llm-bench/endpoints.json`.

---

## What it measures

### 📊 Benchmarks (the "is this endpoint good?" suite)

| Test | What it tells you |
| --- | --- |
| **Time to First Token** | Streaming latency — how long until the *first* token arrives. The #1 "feel" metric. |
| **Output Throughput** | Steady-state tokens/sec during a long generation. |
| **Prompt Caching** | Same big prompt twice: cache read/write tokens, TTFT cold vs warm, cost saved. |
| **Tool-Call Session TTFT** | Agent-style loop: model calls a tool, tool executes, then the TTFT of the reply **after the tool result** — the latency users feel in agent sessions. |

Every run reports: **tokens used** (input / output / cache read / cache write) and **cost incurred** (USD).
Reasoning models (deepseek, kimi, o-series…) have their **thinking tokens tracked separately** and shown as an estimated count.

### 🗂 History — every run is saved

Each finished benchmark run (TUI **and** headless) is saved to `~/.llm-bench/history.json`.
Press **`h`** on the dashboard to browse runs: per-test TTFT / tok/s / cost, cache stats, and open any past run's full report (`d` deletes a run, `x` clears all).

### 💬 Interactive chat — feel the endpoint

A chat window where tokens **stream in live**, with a real-time metrics panel:

- TTFT count-up while you wait for the first token
- live tokens/sec + throughput sparkline
- running token counts and **cache reads/writes** per message
- **cost of each message** and session totals
- **reasoning/thinking tokens stream in a dim italic box** (`🧠 thinking…`), visually distinct from the actual answer
- metrics stay on screen after a turn completes (no more blanking to `—`)
- per-turn TTFT history (`✓ assistant (after tool): 412 ms`)
- tool calling enabled — if the model calls a tool it is executed and the reply TTFT is measured

### 🔑 Keys

| Screen | Keys |
| --- | --- |
| Dashboard | `↵` actions · `n` new · `c` chat · `b` benchmark · `h` history · `e` edit · `d` delete · `r` refresh · `?` help · `q` quit |
| Endpoint form | `Ctrl+S` save · `Esc` cancel · `Tab` next field · `Ctrl+R` autofill pricing |
| Chat | `Enter` send · `Esc` abort / back · `Ctrl+X` new session |
| Benchmarks | `space` toggle test · `a` all · `n` none · `◀▶` iterations · `Enter` run · `Ctrl+C` abort |
| Results | `↑↓` inspect · `r` re-run · `Esc` back |
| History | `↵` open report · `d` delete run · `x` clear all · `Esc` back |
| Anywhere | `Ctrl+C` quits when idle, aborts when a request is in flight |

---

## Headless / CI mode

```sh
# run the full suite and get JSON
bun src/index.ts --headless --endpoint opencode-zen --tests ttft,throughput,cache,toolcall --iterations 3

# only TTFT with a custom prompt, 5 iterations
bun src/index.ts --headless --endpoint my-endpoint --tests ttft --iterations 5 --prompt "Write a haiku about the ocean"

# list configured endpoints (keys masked)
bun src/index.ts --list-endpoints
```

---

## Sample output (real endpoint, deepseek-v4-flash via a gateway)

```
✓ ttft        TTFT  1402.9ms  49.5 tok/s  in    93  out   32  cacheR    0  cacheW  0  $0.00004
✓ throughput  TTFT  1204.3ms  89.6 tok/s  in   139  out 2048  cacheR  128  cacheW  0  $0.00090
✓ cache       TTFT  1219.9ms  91.1 tok/s  in  3327  out   64  cacheR 3200  cacheW  0  $0.00210
              └ warm (cache read)        TTFT  1187.8ms  83.5 tok/s  $0.00105
              cache: read 3200 (49%) · TTFT cold 1220 → warm 1188 · saved $0.00000
✓ toolcall    TTFT  1323.3ms 140.8 tok/s  in   443  out   69  cacheR  384  cacheW  0  $0.00023
              └ turn 2 (after tool call) TTFT  1102.5ms  67.6 tok/s  $0.00006
```

---

## How it works

- **Raw streaming clients** (`src/core/clients/`) — OpenAI-compatible `/chat/completions` SSE and
  Anthropic `/messages` SSE, no SDK dependency, so any gateway/proxy works. Parses usage +
  `prompt_tokens_details.cached_tokens` (OpenAI) and `cache_*_input_tokens` (Anthropic), and separates
  **reasoning tokens** (`reasoning_content` / `thinking_delta`) from answer text.
  Auto-retries without `temperature` when a model rejects it (e.g. thinking-mode models).
- **Benchmark engine** (`src/bench/`) — each test streams real requests and records per-turn
  metrics; TTFT is measured from request start to first output (text *or* tool-call start).
- **TUI** (`src/ui/`) — OpenTUI screens: dashboard, endpoint form, test selector, live chat,
  benchmark runner, results table, run history browser.

## Development

```sh
bun run typecheck
bun scripts/mock-server.ts 8765            # local fake LLM (OpenAI + Anthropic endpoints)
bun scripts/test-pipeline.ts               # client + benchmark engine e2e (needs mock server)
bun scripts/test-ui.ts                     # TUI screens via the OpenTUI test renderer
```

## Notes

- API keys are stored in plaintext in `~/.llm-bench/endpoints.json` — prefer `env:VAR_NAME`
  references for shared machines.
- Cost accuracy depends on the pricing you enter (auto-filled for common models, editable).
- TTFT is measured per-request; first requests can include connection overhead — run multiple
  iterations (`--iterations 3`) and look at the median.
