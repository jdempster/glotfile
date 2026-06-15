import { createRequire } from "node:module";
import type { AiConfig } from "../schema.js";
import {
  buildSystemPrompt, buildBatchPrompt, BATCH_SCHEMA,
  type TranslationProvider, type TranslationRequest, type TranslationResult,
  type CompletionRequest, type BatchCompleteCallback, type MalformedReplyCallback,
} from "./provider.js";
import { runBatched, parseReplyItems, MalformedReplyError, type ReplyItem } from "./batch.js";

// Minimal shape we use from the OpenAI SDK — lets tests inject a fake and keeps
// the SDK's types out of our build.
export interface ChatClient {
  chat: { completions: { create(args: unknown, opts?: { signal?: AbortSignal }): Promise<{ choices: Array<{ message: { content: string | null }; finish_reason?: string }> }> } };
}

export interface OpenAIClientOptions {
  apiKey?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

// Loads the optional `openai` SDK and constructs a client. Shared by the OpenAI
// and OpenRouter providers — OpenRouter is an OpenAI-compatible gateway, so it
// reuses the same SDK with a different base URL, key, and headers.
export function loadOpenAIClient(opts: OpenAIClientOptions): ChatClient {
  const require = createRequire(import.meta.url);
  let OpenAICtor: new (o: OpenAIClientOptions) => ChatClient;
  try {
    const mod = require("openai") as { OpenAI?: unknown; default?: unknown };
    OpenAICtor = (mod.OpenAI ?? mod.default ?? mod) as new (o: OpenAIClientOptions) => ChatClient;
  } catch {
    throw new Error("The OpenAI SDK is required for this provider. Install it: npm i openai");
  }
  return new OpenAICtor(opts);
}

export class OpenAIProvider implements TranslationProvider {
  protected client: ChatClient;
  constructor(protected config: AiConfig, client?: ChatClient) {
    if (client) {
      this.client = client;
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set. AI translation requires it; every other feature works offline.");
    }
    // Optional dependency: loaded only when the openai provider is actually used.
    this.client = loadOpenAIClient({ baseURL: config.endpoint ?? undefined });
  }

  supportsVision(): boolean {
    return true;
  }

  translate(reqs: TranslationRequest[], onBatchComplete?: BatchCompleteCallback, signal?: AbortSignal, onMalformedReply?: MalformedReplyCallback): Promise<TranslationResult[]> {
    return runBatched(reqs, this.config.batchSize, (batch, sig) => this.callBatch(batch, sig), onBatchComplete, signal, onMalformedReply);
  }

  // User content as an array of parts: each unique key's screenshot once (as an
  // image_url data URL), then the batch prompt text describing every item.
  private buildUserContent(batch: TranslationRequest[]): unknown[] {
    const parts: unknown[] = [];
    const seen = new Set<string>();
    for (const req of batch) {
      if (!req.image || seen.has(req.key)) continue;
      seen.add(req.key);
      parts.push({ type: "text", text: `Screenshot for key "${req.key}":` });
      parts.push({ type: "image_url", image_url: { url: `data:${req.image.mediaType};base64,${req.image.base64}` } });
    }
    parts.push({ type: "text", text: buildBatchPrompt(batch) });
    return parts;
  }

  async complete(req: CompletionRequest): Promise<unknown> {
    const content = req.content.map((b) =>
      b.type === "image"
        ? { type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.base64}` } }
        : { type: "text", text: b.text ?? "" },
    );
    const res = await this.client.chat.completions.create({
      model: this.config.model,
      max_tokens: req.maxTokens ?? 8192,
      response_format: { type: "json_schema", json_schema: { name: "completion", schema: req.schema, strict: false } },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content },
      ],
    });
    const text = res.choices?.[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  protected async callBatch(batch: TranslationRequest[], signal?: AbortSignal): Promise<ReplyItem[]> {
    const res = await this.client.chat.completions.create({
      model: this.config.model,
      // strict:false — the shared BATCH_SCHEMA marks only `id` required (each
      // item carries EITHER translation OR forms), which OpenAI's strict mode
      // (all properties required) disallows. We validate the reply ourselves
      // via runBatched, so non-strict schema guidance is sufficient.
      response_format: { type: "json_schema", json_schema: { name: "translations", schema: BATCH_SCHEMA, strict: false } },
      messages: [
        { role: "system", content: buildSystemPrompt(batch.some((r) => r.plural !== undefined)) },
        { role: "user", content: this.buildUserContent(batch) },
      ],
    }, { signal });
    const text = res.choices?.[0]?.message?.content ?? "";
    // A reply cut off at the token cap (finish_reason "length") usually loses
    // tail items even when its prefix parses; treat it as malformed so runBatched
    // bisects into smaller batches rather than silently dropping translations.
    if (res.choices?.[0]?.finish_reason === "length") throw new MalformedReplyError(text);
    // A malformed reply throws MalformedReplyError; runBatched logs the raw
    // reply and retries the batch once before degrading to per-item errors.
    return parseReplyItems(text);
  }
}
