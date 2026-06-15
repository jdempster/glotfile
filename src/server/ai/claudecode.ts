import { spawn } from "node:child_process";
import type { AiConfig } from "../schema.js";
import {
  buildSystemPrompt, buildBatchPrompt, BATCH_SCHEMA,
  type TranslationProvider, type TranslationRequest, type TranslationResult,
  type CompletionRequest, type BatchCompleteCallback, type MalformedReplyCallback,
} from "./provider.js";
import { runBatched, parseReplyItems, type ReplyItem } from "./batch.js";

// Strip optional markdown code fences the CLI may wrap around JSON output.
function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

// The JSON envelope claude --output-format json writes to stdout.
interface ClaudeJsonResult {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

// Injected in tests to avoid spawning a real process.
export type SpawnFn = (
  prompt: string,
  systemPrompt: string,
  model: string,
) => Promise<string>;

export function defaultSpawn(prompt: string, systemPrompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "--print",
      "--output-format", "json",
      "--system-prompt", systemPrompt,
      // Only pass --model when explicitly configured; otherwise use the session default.
      ...(model ? ["--model", model] : []),
    ];

    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    // Write the prompt via stdin to avoid shell-quoting issues with long JSON.
    child.stdin.write(prompt);
    child.stdin.end();

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      try {
        const envelope = JSON.parse(stdout.trim()) as ClaudeJsonResult;
        if (envelope.is_error) {
          reject(new Error(`claude error: ${envelope.result ?? "unknown error"}`));
          return;
        }
        resolve(envelope.result ?? "");
      } catch {
        reject(new Error(`Failed to parse claude JSON output: ${stdout.slice(0, 200)}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}. Is Claude Code installed?`));
    });
  });
}

export class ClaudeCodeProvider implements TranslationProvider {
  private spawnFn: SpawnFn;

  constructor(private config: AiConfig, spawnFn?: SpawnFn) {
    this.spawnFn = spawnFn ?? defaultSpawn;
  }

  supportsVision(): boolean {
    return false;
  }

  translate(reqs: TranslationRequest[], onBatchComplete?: BatchCompleteCallback, signal?: AbortSignal, onMalformedReply?: MalformedReplyCallback): Promise<TranslationResult[]> {
    return runBatched(reqs, this.config.batchSize, (batch, sig) => this.callBatch(batch, sig), onBatchComplete, signal, onMalformedReply);
  }

  async complete(req: CompletionRequest): Promise<unknown> {
    const systemParts = [req.system, `Respond with valid JSON matching this schema: ${JSON.stringify(req.schema)}`];
    const textBlocks = req.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    const result = await this.spawnFn(textBlocks, systemParts.join("\n\n"), this.config.model);
    try {
      return JSON.parse(stripFences(result));
    } catch {
      return {};
    }
  }

  private async callBatch(batch: TranslationRequest[], signal?: AbortSignal): Promise<ReplyItem[]> {
    if (signal?.aborted) return [];

    const prompt = buildBatchPrompt(batch);
    let result: string;
    try {
      result = await this.spawnFn(prompt, buildSystemPrompt(batch.some((r) => r.plural !== undefined)), this.config.model);
    } catch (err) {
      if (signal?.aborted) return [];
      throw err;
    }

    if (signal?.aborted) return [];

    // An unparseable reply throws MalformedReplyError carrying the raw text;
    // runBatched logs it and retries the batch once before degrading.
    return parseReplyItems(stripFences(result));
  }
}
