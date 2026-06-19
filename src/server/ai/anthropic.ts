import Anthropic from "@anthropic-ai/sdk";
import type { AiConfig } from "../schema.js";
import {
  buildSystemPrompt, buildBatchPrompt, BATCH_SCHEMA,
  type TranslationProvider, type TranslationRequest, type TranslationResult,
  type CompletionRequest, type BatchCompleteCallback, type MalformedReplyCallback,
  type BatchJobSpec, type BatchJobOutcome, type BatchRunStatus, type BatchCompletionProvider,
  type CompletionBatchJob, type CompletionBatchOutcome, type ChatProvider,
} from "./provider.js";
import type { ChatMessage, ChatContentBlock, ChatEvent, ToolDef } from "./chat-types.js";
import { runBatched, parseReplyItems, MalformedReplyError, type ReplyItem } from "./batch.js";
import { addUsage, type TokenUsage } from "./pricing.js";

interface ApiUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface BatchEntry {
  custom_id: string;
  result: {
    type: string;
    message?: { content: Array<{ type: string; text?: string }>; usage?: ApiUsage };
    error?: { type?: string; message?: string };
  };
}

// One assistant content block as returned by the Messages API (the subset we map).
interface ApiBlock { type: string; text?: string; id?: string; name?: string; input?: unknown; thinking?: string; signature?: string; data?: string }
interface ApiMessage { content: ApiBlock[]; usage?: ApiUsage; stop_reason?: string }
// A streamed turn: async-iterable raw events for live text, plus the assembled
// final message (thinking blocks carry their signature here).
type ChatStreamHandle = AsyncIterable<{ type: string; delta?: { type: string; text?: string } }> & { finalMessage(): Promise<ApiMessage> };

// Models that support adaptive thinking + the effort knob (Opus 4.6+, Sonnet 4.6,
// Fable 5 / Mythos 5). Older models 400 on those params, so we omit them there.
function supportsAdaptiveThinking(model: string): boolean {
  return /opus-4-[678]|sonnet-4-6|fable-5|mythos-5/i.test(model);
}

// Minimal shape we use from the SDK — lets tests inject a fake.
interface MessagesClient {
  messages: {
    create(args: unknown, opts?: { signal?: AbortSignal }): Promise<{ content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>; usage?: ApiUsage; stop_reason?: string }>;
    stream(args: unknown, opts?: { signal?: AbortSignal }): ChatStreamHandle;
    batches?: {
      create(args: unknown): Promise<{ id: string }>;
      retrieve(id: string): Promise<{ processing_status: string; request_counts: BatchRunStatus["counts"] }>;
      results(id: string): Promise<AsyncIterable<BatchEntry>>;
      cancel(id: string): Promise<unknown>;
    };
  };
}

export class AnthropicProvider implements BatchCompletionProvider, ChatProvider {
  private client: MessagesClient;
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  constructor(private config: AiConfig, client?: MessagesClient) {
    if (client) {
      this.client = client;
    } else {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not set. AI translation requires it; every other feature works offline.");
      }
      this.client = new Anthropic({ baseURL: config.endpoint ?? undefined }) as unknown as MessagesClient;
    }
  }

  supportsVision(): boolean {
    return true;
  }

  private recordUsage(usage: ApiUsage | undefined): void {
    if (!usage) return;
    addUsage(this.usage, {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    });
  }

  takeUsage(): TokenUsage | undefined {
    const taken = this.usage;
    this.usage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    const any = taken.inputTokens || taken.outputTokens || taken.cacheCreationInputTokens || taken.cacheReadInputTokens;
    return any ? taken : undefined;
  }

  translate(reqs: TranslationRequest[], onBatchComplete?: BatchCompleteCallback, signal?: AbortSignal, onMalformedReply?: MalformedReplyCallback): Promise<TranslationResult[]> {
    return runBatched(reqs, this.config.batchSize, (batch, sig) => this.callBatch(batch, sig), onBatchComplete, signal, onMalformedReply);
  }

  // Build the user message as content blocks: each unique key's screenshot is
  // sent once (a key recurs once per target locale in a batch — dedupe by key),
  // then the batch prompt text describes every item.
  private buildUserContent(batch: TranslationRequest[]): unknown[] {
    const content: unknown[] = [];
    const seen = new Set<string>();
    for (const req of batch) {
      if (!req.image || seen.has(req.key)) continue;
      seen.add(req.key);
      content.push({ type: "text", text: `Screenshot for key "${req.key}":` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: req.image.mediaType, data: req.image.base64 },
      });
    }
    content.push({ type: "text", text: buildBatchPrompt(batch) });
    return content;
  }

  private completionContent(req: CompletionRequest): unknown[] {
    return req.content.map((b) =>
      b.type === "image"
        ? { type: "image", source: { type: "base64", media_type: b.mediaType, data: b.base64 } }
        : { type: "text", text: b.text ?? "" },
    );
  }

  async complete(req: CompletionRequest): Promise<unknown> {
    const content = this.completionContent(req);
    const res = await this.client.messages.create({
      model: this.config.model,
      max_tokens: req.maxTokens ?? 8192,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: req.schema } },
      messages: [{ role: "user", content }],
    });
    this.recordUsage(res.usage);
    const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  // Map our provider-agnostic chat blocks to the Messages API content shape.
  // Thinking blocks round-trip verbatim (signature included) — required when
  // replaying a thought tool-use turn.
  private toApiContent(blocks: ChatContentBlock[]): Record<string, unknown>[] {
    return blocks.map((b) => {
      if (b.type === "text") return { type: "text", text: b.text };
      if (b.type === "thinking") return { type: "thinking", thinking: b.thinking, signature: b.signature };
      if (b.type === "redacted_thinking") return { type: "redacted_thinking", data: b.data };
      if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, is_error: b.isError ?? false };
    });
  }

  // Map an API content block back to our provider-agnostic shape.
  private fromApiBlock(b: ApiBlock): ChatContentBlock {
    if (b.type === "thinking") return { type: "thinking", thinking: b.thinking ?? "", signature: b.signature ?? "" };
    if (b.type === "redacted_thinking") return { type: "redacted_thinking", data: b.data ?? "" };
    if (b.type === "tool_use") return { type: "tool_use", id: b.id ?? "", name: b.name ?? "", input: b.input };
    return { type: "text", text: b.text ?? "" };
  }

  // One conversational turn, streamed. The stable system prompt + tools are
  // cache-flagged (a breakpoint on the stable block also caches the tools that
  // render before it); the volatile project snapshot rides in a second, uncached
  // system block so it never busts that prefix. A breakpoint on the last message
  // caches the growing conversation. We stream text deltas for live display, then
  // emit turn_end with the fully-assembled content (thinking + text + tool_use).
  async *chat(messages: ChatMessage[], tools: ToolDef[], system: string, signal?: AbortSignal, context?: string): AsyncGenerator<ChatEvent> {
    const adaptive = supportsAdaptiveThinking(this.config.model);
    const apiMessages = messages.map((m) => ({ role: m.role, content: this.toApiContent(m.content) }));
    const lastMsg = apiMessages[apiMessages.length - 1];
    const lastBlock = lastMsg?.content[lastMsg.content.length - 1];
    if (lastBlock) lastBlock.cache_control = { type: "ephemeral" };

    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: 16000,
      ...(adaptive ? { thinking: { type: "adaptive" }, output_config: { effort: "medium" } } : {}),
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
        ...(context ? [{ type: "text", text: context }] : []),
      ],
      ...(tools.length
        ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, ...(t.strict ? { strict: true } : {}) })) }
        : {}),
      messages: apiMessages,
    }, { signal });

    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
        yield { type: "text", delta: ev.delta.text };
      }
    }
    const final = await stream.finalMessage();
    this.recordUsage(final.usage);
    yield { type: "turn_end", stopReason: final.stop_reason ?? "end_turn", content: final.content.map((b) => this.fromApiBlock(b)) };
  }

  private batchesClient() {
    const b = this.client.messages.batches;
    if (!b) throw new Error("Anthropic client has no batches support.");
    return b;
  }

  // Each job becomes one batch entry whose params mirror callBatch exactly —
  // same prompts, schema, and vision blocks — so batch and sync replies are
  // interchangeable downstream.
  async submitTranslationBatch(jobs: BatchJobSpec[]): Promise<string> {
    const requests = jobs.map((job) => ({
      custom_id: job.customId,
      params: {
        model: this.config.model,
        max_tokens: 8192,
        // Batch entries don't share a live cache window, so cache_control is omitted here.
        system: [{ type: "text", text: buildSystemPrompt(job.requests) }],
        output_config: { format: { type: "json_schema", schema: BATCH_SCHEMA } },
        messages: [{ role: "user", content: this.buildUserContent(job.requests) }],
      },
    }));
    const res = await this.batchesClient().create({ requests });
    return res.id;
  }

  async translationBatchStatus(batchId: string): Promise<BatchRunStatus> {
    const r = await this.batchesClient().retrieve(batchId);
    return { status: r.processing_status as BatchRunStatus["status"], counts: r.request_counts };
  }

  async translationBatchResults(batchId: string): Promise<Map<string, BatchJobOutcome>> {
    const out = new Map<string, BatchJobOutcome>();
    for await (const entry of await this.batchesClient().results(batchId)) {
      if (entry.result.type !== "succeeded") {
        out.set(entry.custom_id, { type: "failed", error: entry.result.error?.message ?? entry.result.type });
        continue;
      }
      this.recordUsage(entry.result.message?.usage);
      const text = entry.result.message?.content.find((b) => b.type === "text")?.text ?? "";
      try {
        out.set(entry.custom_id, { type: "items", items: parseReplyItems(text) });
      } catch (err) {
        if (!(err instanceof MalformedReplyError)) throw err;
        out.set(entry.custom_id, { type: "malformed", raw: err.raw });
      }
    }
    return out;
  }

  async cancelTranslationBatch(batchId: string): Promise<void> {
    await this.batchesClient().cancel(batchId);
  }

  // Mirrors complete() exactly — same prompts and schema — so batch and sync
  // completion replies are interchangeable downstream.
  async submitCompletionBatch(jobs: CompletionBatchJob[]): Promise<string> {
    const requests = jobs.map((job) => ({
      custom_id: job.customId,
      params: {
        model: this.config.model,
        max_tokens: job.request.maxTokens ?? 8192,
        // Batch entries don't share a live cache window, so cache_control is omitted here.
        system: [{ type: "text", text: job.request.system }],
        output_config: { format: { type: "json_schema", schema: job.request.schema } },
        messages: [{ role: "user", content: this.completionContent(job.request) }],
      },
    }));
    const res = await this.batchesClient().create({ requests });
    return res.id;
  }

  async completionBatchResults(batchId: string): Promise<Map<string, CompletionBatchOutcome>> {
    const out = new Map<string, CompletionBatchOutcome>();
    for await (const entry of await this.batchesClient().results(batchId)) {
      if (entry.result.type !== "succeeded") {
        out.set(entry.custom_id, { type: "failed", error: entry.result.error?.message ?? entry.result.type });
        continue;
      }
      this.recordUsage(entry.result.message?.usage);
      const text = entry.result.message?.content.find((b) => b.type === "text")?.text ?? "";
      try {
        out.set(entry.custom_id, { type: "json", value: JSON.parse(text) });
      } catch {
        out.set(entry.custom_id, { type: "malformed", raw: text });
      }
    }
    return out;
  }

  private async callBatch(batch: TranslationRequest[], signal?: AbortSignal): Promise<ReplyItem[]> {
    const content = this.buildUserContent(batch);
    const res = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 8192,
      system: [{ type: "text", text: buildSystemPrompt(batch), cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: BATCH_SCHEMA } },
      messages: [{ role: "user", content }],
    }, { signal });
    this.recordUsage(res.usage);
    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    // A reply cut off at the output-token cap usually loses tail items even when
    // its prefix parses; treat it as malformed so runBatched bisects into smaller
    // batches (whose replies fit) rather than silently dropping translations.
    if (res.stop_reason === "max_tokens") throw new MalformedReplyError(text);
    // A malformed model reply (seen in the wild: an unescaped quote inside a
    // translation breaking the JSON) throws MalformedReplyError; runBatched
    // logs the raw reply and retries the batch once before degrading.
    return parseReplyItems(text);
  }
}
