import type { Endpoint } from "../types.ts";
import type { LLMClient } from "./client.ts";
import { OpenAIClient } from "./openai.ts";
import { AnthropicClient } from "./anthropic.ts";

export function createClient(endpoint: Endpoint): LLMClient {
  switch (endpoint.provider) {
    case "openai":
      return new OpenAIClient(endpoint);
    case "anthropic":
      return new AnthropicClient(endpoint);
  }
}
