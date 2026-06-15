import { createRequire } from "node:module";
import type { AiConfig } from "../schema.js";
import {
  buildSystemPrompt, buildBatchPrompt, BATCH_SCHEMA,
  type TranslationProvider, type TranslationRequest, type TranslationResult,
  type CompletionRequest, type BatchCompleteCallback, type MalformedReplyCallback,
} from "./provider.js";
import { runBatched, parseReplyItems, MalformedReplyError, type ReplyItem } from "./batch.js";

// Minimal shapes we use — lets tests inject fakes and keeps SDK types out of the build.
interface BedrockClient {
  send(command: unknown, opts?: { abortSignal?: AbortSignal }): Promise<{ output?: { message?: { content?: unknown[] } } }>;
}
// Injected by tests: a fake client plus a no-op command wrapper, so we can
// assert on the exact Converse input without the real SDK Command class.
interface BedrockDeps { client: BedrockClient; makeCommand: (input: unknown) => unknown }

const IMAGE_FORMATS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/gif": "gif",
};

export class BedrockProvider implements TranslationProvider {
  private client: BedrockClient;
  private makeCommand: (input: unknown) => unknown;
  constructor(private config: AiConfig, deps?: BedrockDeps) {
    if (deps) {
      this.client = deps.client;
      this.makeCommand = deps.makeCommand;
      return;
    }
    const region = config.region ?? process.env.AWS_REGION;
    if (!region) {
      throw new Error("AWS region is not set. Set the Region in your local AI settings (.glotfile/settings.json) or the AWS_REGION environment variable for the bedrock provider.");
    }
    // Optional dependency: loaded only when the bedrock provider is actually used.
    const require = createRequire(import.meta.url);
    let sdk: {
      BedrockRuntimeClient: new (o: { region: string }) => BedrockClient;
      ConverseCommand: new (input: unknown) => unknown;
    };
    try {
      sdk = require("@aws-sdk/client-bedrock-runtime");
    } catch {
      throw new Error('Provider "bedrock" requires the AWS SDK. Install it: npm i @aws-sdk/client-bedrock-runtime');
    }
    // Credentials come from the standard AWS chain (env / AWS_PROFILE / SSO /
    // instance role) — no API key is read or stored.
    this.client = new sdk.BedrockRuntimeClient({ region });
    this.makeCommand = (input) => new sdk.ConverseCommand(input);
  }

  // Meta Llama text models on Bedrock support neither vision nor reliable
  // forced tool-use; Nova and Claude support both.
  private isMeta(): boolean {
    return this.config.model.includes("meta.");
  }

  supportsVision(): boolean {
    return !this.isMeta();
  }

  translate(reqs: TranslationRequest[], onBatchComplete?: BatchCompleteCallback, signal?: AbortSignal, onMalformedReply?: MalformedReplyCallback): Promise<TranslationResult[]> {
    return runBatched(reqs, this.config.batchSize, (batch, sig) => this.callBatch(batch, sig), onBatchComplete, signal, onMalformedReply);
  }

  private buildContentBlocks(batch: TranslationRequest[]): unknown[] {
    const blocks: unknown[] = [];
    if (this.supportsVision()) {
      const seen = new Set<string>();
      for (const req of batch) {
        if (!req.image || seen.has(req.key)) continue;
        const format = IMAGE_FORMATS[req.image.mediaType];
        if (!format) continue;
        seen.add(req.key);
        blocks.push({ text: `Screenshot for key "${req.key}":` });
        blocks.push({ image: { format, source: { bytes: Buffer.from(req.image.base64, "base64") } } });
      }
    }
    blocks.push({ text: buildBatchPrompt(batch) });
    return blocks;
  }

  async complete(req: CompletionRequest): Promise<unknown> {
    const blocks = req.content.map((b) =>
      b.type === "image" && this.supportsVision()
        ? { image: { format: IMAGE_FORMATS[b.mediaType ?? ""] ?? "png", source: { bytes: Buffer.from(b.base64 ?? "", "base64") } } }
        : { text: b.text ?? "" },
    );
    const SCHEMA_NAME = "emit_completion";
    const input = {
      modelId: this.config.model,
      system: [{ text: req.system }],
      messages: [{ role: "user", content: blocks }],
      ...(this.isMeta() ? {} : {
        toolConfig: {
          tools: [{ toolSpec: { name: SCHEMA_NAME, inputSchema: { json: req.schema } } }],
          toolChoice: { tool: { name: SCHEMA_NAME } },
        },
      }),
    };
    const res = await this.client.send(this.makeCommand(input));
    const content = (res.output?.message?.content ?? []) as Array<{
      toolUse?: { input?: unknown };
      text?: string;
    }>;
    const tool = content.find((b) => b.toolUse)?.toolUse;
    if (tool?.input) return tool.input;
    const text = content.find((b) => b.text)?.text ?? "{}";
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  private buildInput(batch: TranslationRequest[]): unknown {
    const input: Record<string, unknown> = {
      modelId: this.config.model,
      system: [{ text: buildSystemPrompt(batch.some((r) => r.plural !== undefined)) }],
      messages: [{ role: "user", content: this.buildContentBlocks(batch) }],
    };
    // Force structured output via a single tool, except for models without
    // reliable tool-use (Meta) — those rely on the prompt-and-parse fallback.
    if (!this.isMeta()) {
      input.toolConfig = {
        tools: [{ toolSpec: { name: "emit_translations", inputSchema: { json: BATCH_SCHEMA } } }],
        toolChoice: { tool: { name: "emit_translations" } },
      };
    }
    return input;
  }

  private async callBatch(batch: TranslationRequest[], signal?: AbortSignal): Promise<ReplyItem[]> {
    const res = await this.client.send(this.makeCommand(this.buildInput(batch)), { abortSignal: signal });
    const blocks = (res.output?.message?.content ?? []) as Array<{
      toolUse?: { input?: { items?: ReplyItem[] } };
      text?: string;
    }>;
    const tool = blocks.find((b) => b.toolUse)?.toolUse;
    const text = blocks.find((b) => b.text)?.text ?? "";
    // A reply cut off at the token cap usually loses tail items even when its
    // prefix parses; treat it as malformed so runBatched bisects into smaller
    // batches rather than silently dropping translations.
    if ((res as { stopReason?: string }).stopReason === "max_tokens") {
      throw new MalformedReplyError(text || JSON.stringify(tool?.input ?? {}));
    }
    if (tool?.input?.items) return tool.input.items;
    // Fallback for Meta (no tool-use) or a malformed reply: parse a JSON text
    // block. An unparseable reply throws MalformedReplyError; runBatched logs
    // the raw reply and retries the batch once before degrading.
    return parseReplyItems(text);
  }
}
