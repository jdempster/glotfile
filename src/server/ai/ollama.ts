import type { AiConfig } from "../schema.js";
import {
  buildTranslateGemmaSystemPrompt, buildTranslateGemmaUserPrompt, parseTranslateGemmaResponse,
  type TranslationRequest,
} from "./provider.js";
import { OpenAIProvider, loadOpenAIClient, type ChatClient, type OpenAIClientOptions } from "./openai.js";
import type { ReplyItem } from "./batch.js";

// Ollama's OpenAI-compatible API lives under /v1 on the local daemon.
const OLLAMA_BASE_URL = "http://localhost:11434/v1";

// Builds the OpenAI-SDK client options for Ollama. Local Ollama needs no auth,
// but the SDK requires a non-empty key, so we fall back to a placeholder.
// OLLAMA_API_KEY is honored for secured or remote deployments. The base URL is
// overridable via config.endpoint (which must include the /v1 suffix). Kept pure
// and exported so the Ollama-specific wiring is unit testable without the SDK.
export function ollamaClientOptions(config: AiConfig): OpenAIClientOptions {
  return {
    apiKey: process.env.OLLAMA_API_KEY ?? "ollama",
    baseURL: config.endpoint ?? OLLAMA_BASE_URL,
  };
}

// Ollama speaks the OpenAI chat-completions API, so translation and completion
// behavior is inherited from OpenAIProvider — only the client (base URL, key)
// differs. Vision defaults to off (most local models are text-only); set
// config.vision=true for models that support image input (e.g. translategemma).
// The translategemma strategy uses a per-item plain-text prompt rather than
// the default JSON batch format; all other models use the inherited path.
export class OllamaProvider extends OpenAIProvider {
  constructor(config: AiConfig, client?: ChatClient) {
    super(config, client ?? loadOpenAIClient(ollamaClientOptions(config)));
  }

  override supportsVision(): boolean {
    return this.config.vision === true;
  }

  // translategemma expects a per-item system prompt, a plain-text user message
  // (no JSON, no structured output), and returns a plain-text translation.
  protected override async callBatch(batch: TranslationRequest[], signal?: AbortSignal): Promise<ReplyItem[]> {
    if (this.config.promptStyle !== "translategemma") {
      return super.callBatch(batch, signal);
    }
    const results: ReplyItem[] = [];
    for (const req of batch) {
      const res = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: "system", content: buildTranslateGemmaSystemPrompt(req.sourceLocale, req.targetLocale) },
          { role: "user", content: buildTranslateGemmaUserPrompt(req.source) },
        ],
      }, { signal });
      const text = res.choices?.[0]?.message?.content ?? "";
      results.push(parseTranslateGemmaResponse(text, req.id) as ReplyItem);
    }
    return results;
  }
}
