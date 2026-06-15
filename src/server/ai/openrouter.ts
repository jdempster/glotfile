import type { AiConfig } from "../schema.js";
import { OpenAIProvider, loadOpenAIClient, type ChatClient } from "./openai.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
// Attribution headers OpenRouter uses for its app rankings and free-tier limits.
const OPENROUTER_REFERER = "https://www.npmjs.com/package/glotfile";
const OPENROUTER_TITLE = "glotfile";

// Builds the OpenAI-SDK client options for OpenRouter: its API key, the
// OpenRouter base URL (overridable via config.endpoint), and the attribution
// headers. Kept pure and exported so the OpenRouter-specific behavior is unit
// testable without constructing the SDK.
export function openRouterClientOptions(config: AiConfig): { apiKey: string; baseURL: string; defaultHeaders: Record<string, string> } {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. AI translation requires it; every other feature works offline.");
  }
  return {
    apiKey,
    baseURL: config.endpoint ?? OPENROUTER_BASE_URL,
    defaultHeaders: { "HTTP-Referer": OPENROUTER_REFERER, "X-Title": OPENROUTER_TITLE },
  };
}

// OpenRouter speaks the OpenAI chat-completions API, so the entire translation,
// vision, and completion behavior is inherited from OpenAIProvider — only the
// client (base URL, key, headers) differs.
export class OpenRouterProvider extends OpenAIProvider {
  constructor(config: AiConfig, client?: ChatClient) {
    super(config, client ?? loadOpenAIClient(openRouterClientOptions(config)));
  }
}
