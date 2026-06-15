import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultState } from "../schema.js";
import { createKey } from "../state.js";
import type { AiConfig, State } from "../schema.js";
import type { BatchCompletionProvider, CompletionBatchJob, CompletionBatchOutcome, CompletionRequest } from "./provider.js";
import type { ContextRequest } from "./context.js";
import { submitContextBatch, applyContextBatchResults } from "./context-batch-run.js";
import { loadPendingContextBatch } from "./pending-context-batch.js";
import { readLog } from "../log.js";

function makeState(): State {
  const s = defaultState();
  s.config.sourceLocale = "en";
  s.config.locales = ["en", "de"];
  createKey(s, "greeting", "Hello");
  createKey(s, "farewell", "Bye");
  return s;
}

function targetsFor(state: State): ContextRequest[] {
  return Object.keys(state.keys).map((key, i) => ({
    id: String(i),
    key,
    source: state.keys[key]!.values[state.config.sourceLocale]?.value ?? "",
    usageSnippets: [],
  }));
}

function makeProvider(
  outcomes: Map<string, CompletionBatchOutcome>,
  completeReply: (req: CompletionRequest) => unknown = () => ({ items: [] }),
) {
  const seen: { jobs?: CompletionBatchJob[]; completions: CompletionRequest[] } = { completions: [] };
  const provider: BatchCompletionProvider = {
    supportsVision: () => false,
    translate: async () => [],
    complete: async (req) => { seen.completions.push(req); return completeReply(req); },
    submitTranslationBatch: async () => "msgbatch_unused",
    translationBatchStatus: async () => ({ status: "ended", counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 } }),
    translationBatchResults: async () => new Map(),
    cancelTranslationBatch: async () => {},
    submitCompletionBatch: async (jobs) => { seen.jobs = jobs; return "msgbatch_ctx"; },
    completionBatchResults: async () => outcomes,
  };
  return { provider, seen };
}

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "glotfile-ctxbatch-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const AI: AiConfig = { provider: "anthropic", model: "claude-sonnet-4-6", endpoint: null, batchSize: 50 };

describe("submitContextBatch", () => {
  it("chunks targets, submits, and persists the handle", async () => {
    const state = makeState();
    const targets = targetsFor(state);
    const { provider, seen } = makeProvider(new Map());
    const pending = await submitContextBatch(provider, targets, 1, "claude-sonnet-4-6", root, false);
    expect(pending.batchId).toBe("msgbatch_ctx");
    // batchSize 1 → one job per key, ids stable per chunk index.
    expect(seen.jobs?.map((j) => j.customId)).toEqual(["ctx_0", "ctx_1"]);
    const onDisk = loadPendingContextBatch(root)!;
    expect(onDisk.total).toBe(2);
    expect(onDisk.force).toBe(false);
    // Chunking preserves target order.
    expect(onDisk.jobs.flatMap((j) => j.requests.map((r) => r.key))).toEqual(targets.map((t) => t.key));
  });

  it("refuses when a context batch is already pending", async () => {
    const state = makeState();
    const { provider } = makeProvider(new Map());
    await submitContextBatch(provider, targetsFor(state), 50, "m", root, false);
    await expect(submitContextBatch(provider, targetsFor(state), 50, "m", root, false)).rejects.toThrow(/already pending/);
  });
});

describe("applyContextBatchResults", () => {
  it("applies parsed contexts, retries failed jobs synchronously, and logs", async () => {
    const state = makeState();
    const targets = targetsFor(state);
    const { provider: submitProvider } = makeProvider(new Map());
    const pending = await submitContextBatch(submitProvider, targets, 1, "claude-sonnet-4-6", root, false);

    // ctx_0 parsed fine; ctx_1 failed → sync retry.
    const jobReq = (i: number) => pending.jobs[i]!.requests[0]!;
    const outcomes = new Map<string, CompletionBatchOutcome>([
      ["ctx_0", { type: "json", value: { items: [{ id: jobReq(0).id, context: "Context from the batch" }] } }],
      ["ctx_1", { type: "failed", error: "expired" }],
    ]);
    const { provider, seen } = makeProvider(outcomes, () => ({ items: [{ id: jobReq(1).id, context: "Context from the sync retry" }] }));
    const drained = [undefined, { inputTokens: 1_000_000, outputTokens: 100_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, undefined];
    provider.takeUsage = () => drained.shift() ?? undefined;

    const out = await applyContextBatchResults(() => state, () => {}, provider, pending, root, AI);
    expect(out.written).toBe(2);
    expect(out.retried).toBe(1);
    expect(out.errors).toEqual([]);
    expect(seen.completions).toHaveLength(1);
    expect(state.keys[jobReq(0).key]!.context).toBe("Context from the batch");
    expect(state.keys[jobReq(1).key]!.context).toBe("Context from the sync retry");
    expect(loadPendingContextBatch(root)).toBeUndefined();

    const entry = readLog(root, 1)[0]!;
    // Sonnet 4.6 at $3/$15 per MTok, halved for batch: (3 + 1.5) * 0.5 = 2.25.
    expect(entry.summary).toBe(`Applied context batch msgbatch_ctx: wrote 2, 0 error(s), 1 job(s) retried (~$2.25)`);
    expect(entry.kind).toBe("context");
    expect(entry.jobFailures).toEqual([{ customId: "ctx_1", locale: "", type: "failed", error: "expired" }]);
    expect(entry.estimatedCostUsd).toBeCloseTo(2.25);
  });

  it("leaves the pending handle intact when completionBatchResults rejects", async () => {
    const state = makeState();
    const { provider } = makeProvider(new Map());
    const pending = await submitContextBatch(provider, targetsFor(state), 50, "m", root, false);
    provider.completionBatchResults = async () => { throw new Error("network timeout"); };
    await expect(
      applyContextBatchResults(() => state, () => {}, provider, pending, root, AI),
    ).rejects.toThrow("network timeout");
    expect(loadPendingContextBatch(root)).toBeDefined();
  });
});
