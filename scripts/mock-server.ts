// Mock LLM server (OpenAI-compatible + Anthropic) for local testing without real API keys.
// Usage: bun scripts/mock-server.ts [port]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8765);

const HAIR = `The quick brown fox jumps over the lazy dog. `.repeat(60); // ~3300 tokens worth of text

function usageTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function openaiChunk(delta: Record<string, unknown>, finish?: string): string {
  const c: Record<string, unknown> = {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "mock-model",
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  };
  if (finish) delete c.choices;
  return `data: ${JSON.stringify(c)}\n\n`;
}

const server = createServer((req, res) => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    let json: any = {};
    try {
      json = JSON.parse(body || "{}");
    } catch {
      /* ignore */
    }

    if (req.url?.startsWith("/v1/chat/completions")) {
      const toolCalls = json.tools?.length ? true : false;
      const prompt = JSON.stringify(json.messages ?? "").length;
      const maxTokens = json.max_tokens ?? 128;

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", created: Date.now(), model: "mock-model", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`);

      void (async () => {
        await delay(120); // simulated TTFT delay

        if (toolCalls) {
          // Think first (like deepseek/kimi), then call the tool
          const thinking = ["The", "user", "wants", "a", "calculation.", "Let", "me", "use", "the", "tool."];
          for (const w of thinking) {
            res.write(openaiChunk({ reasoning_content: w + " " }));
            await delay(12);
          }
          // Emit a tool call first
          const tc = {
            id: "call_mock_1",
            index: 0,
            type: "function",
            function: { name: "calculator", arguments: "" },
          };
          res.write(openaiChunk({ tool_calls: [tc] }));
          await delay(40);
          res.write(openaiChunk({ tool_calls: [{ index: 0, function: { arguments: '{"expression":"17*23"}' } }] }));
          await delay(60);
          res.write(openaiChunk({ content: "", finish_reason: "tool_calls" }));
          res.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", created: Date.now(), model: "mock-model", choices: [], usage: { prompt_tokens: usageTokens("x".repeat(prompt)), completion_tokens: 8, total_tokens: 8 } })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        // Stream a haiku-ish reply, with reasoning tokens first (like deepseek/kimi)
        const thinking = ["Hmm,", "the", "user", "wants", "a", "short", "reply.", "Let", "me", "keep", "it", "simple."];
        for (const w of thinking) {
          res.write(openaiChunk({ reasoning_content: w + " " }));
          await delay(12);
        }
        const words = ["Streaming", "tokens", "arrive", "one", "by", "one,", "like", "rain", "on", "a", "quiet", "roof.", "\n"];
        for (const w of words) {
          res.write(openaiChunk({ content: w + " " }));
          await delay(30);
        }
        res.write(openaiChunk({ content: "", finish_reason: "stop" }));
        res.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", created: Date.now(), model: "mock-model", choices: [], usage: { prompt_tokens: usageTokens("x".repeat(prompt)), completion_tokens: Math.min(maxTokens, 20), total_tokens: Math.min(maxTokens, 20), prompt_tokens_details: { cached_tokens: 0 } } })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      })();
      return;
    }

    if (req.url?.startsWith("/v1/messages")) {
      const maxTokens = json.max_tokens ?? 128;
      const useTool = json.tools?.length ? true : false;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });

      const send = (e: string, data: unknown) => res.write(`event: ${e}\ndata: ${JSON.stringify(data)}\n\n`);

      void (async () => {
        send("message_start", {
          type: "message_start",
          message: {
            id: "msg_mock",
            type: "message",
            role: "assistant",
            model: "mock-model",
            content: [],
            stop_reason: null,
            usage: { input_tokens: 50, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        });
        await delay(150);

        if (useTool) {
          send("content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "toolu_mock_1", name: "calculator", input: {} },
          });
          await delay(40);
          send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"expression":"17*23"}' } });
          await delay(40);
          send("content_block_stop", { type: "content_block_stop", index: 0 });
          send("message_delta", {
            type: "message_delta",
            delta: { stop_reason: "tool_use", stop_sequence: null },
            usage: { output_tokens: 6 },
          });
          send("message_stop", { type: "message_stop" });
          res.end();
          return;
        }

        const words = ["Streaming", "tokens", "arrive", "one", "by", "one,", "like", "rain", "on", "a", "quiet", "roof."];
        for (const w of words) {
          send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: w + " " } });
          await delay(30);
        }
        send("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: Math.min(maxTokens, 20) },
        });
        send("message_stop", { type: "message_stop" });
        res.end();
      })();
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
});

server.listen(port, () => {
  console.log(`mock LLM server listening on http://localhost:${port}/v1`);
  console.log(`  OpenAI:   POST /v1/chat/completions`);
  console.log(`  Anthropic: POST /v1/messages`);
});
