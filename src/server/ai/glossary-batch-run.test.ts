import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultState } from "../schema.js";
import type { AiConfig, State } from "../schema.js";
import type { BatchCompletionProvider, CompletionBatchJob, CompletionBatchOutcome, CompletionRequest } from "./provider.js";
import type { GlossarySource } from "./glossary-suggest.js";
import { submitGlossarySuggestBatch, applyGlossarySuggestBatchResults } from "./glossary-batch-run.js";
import { loadPendingGlossaryBatch } from "./pending-glossary-batch.js";
import { readLog } from "../log.js";

function makeProvider(
  outcomes: Map<string, CompletionBatchOutcome>,
  completeReply: (req: CompletionRequest) => unknown = () => ({ terms: [] }),
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
    submitCompletionBatch: async (jobs) => { seen.jobs = jobs; return "msgbatch_g"; },
    completionBatchResults: async () => outcomes,
  };
  return { provider, seen };
}

const SOURCES: GlossarySource[] = [{ key: "a", source: "Sign in to Acme" }, { key: "b", source: "Open the Beta panel" }];
const AI: AiConfig = { provider: "anthropic", model: "claude-sonnet-4-6", endpoint: null, batchSize: 50 };
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "glotfile-gbatch-run-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("submitGlossarySuggestBatch", () => {
  it("chunks sources, submits, persists the handle", async () => {
    const { provider, seen } = makeProvider(new Map());
    const pending = await submitGlossarySuggestBatch(provider, SOURCES, ["Widget"], 1, "claude-sonnet-4-6", root);
    expect(pending.batchId).toBe("msgbatch_g");
    expect(seen.jobs?.map((j) => j.customId)).toEqual(["gloss_0", "gloss_1"]);
    const onDisk = loadPendingGlossaryBatch(root)!;
    expect(onDisk.total).toBe(2);
    expect(onDisk.knownTerms).toEqual(["Widget"]);
    expect(onDisk.jobs.flatMap((j) => j.requests.map((r) => r.key))).toEqual(["a", "b"]);
  });

  it("refuses when a glossary batch is already pending", async () => {
    const { provider } = makeProvider(new Map());
    await submitGlossarySuggestBatch(provider, SOURCES, [], 50, "m", root);
    await expect(submitGlossarySuggestBatch(provider, SOURCES, [], 50, "m", root)).rejects.toThrow(/already pending/);
  });
});

describe("applyGlossarySuggestBatchResults", () => {
  it("merges parsed terms, retries failed jobs synchronously, logs, clears", async () => {
    const state = defaultState(); state.config.sourceLocale = "en"; state.config.locales = ["en"];
    const { provider: sub } = makeProvider(new Map());
    const pending = await submitGlossarySuggestBatch(sub, SOURCES, [], 1, "claude-sonnet-4-6", root);
    const outcomes = new Map<string, CompletionBatchOutcome>([
      ["gloss_0", { type: "json", value: { terms: [{ term: "Acme", doNotTranslate: true }] } }],
      ["gloss_1", { type: "failed", error: "expired" }],
    ]);
    const { provider, seen } = makeProvider(outcomes, () => ({ terms: [{ term: "Beta" }] }));
    const out = await applyGlossarySuggestBatchResults(() => state, () => {}, provider, pending, root, AI);
    expect(out.added).toBe(2);
    expect(out.retried).toBe(1);
    expect(out.errors).toEqual([]);
    expect(seen.completions).toHaveLength(1);
    expect(state.glossarySuggestions.map((s) => s.term).sort()).toEqual(["Acme", "Beta"]);
    expect(loadPendingGlossaryBatch(root)).toBeUndefined();
    const entry = readLog(root, 1)[0]!;
    expect(entry.kind).toBe("glossary");
    expect(entry.summary).toContain(pending.batchId);
  });

  it("leaves the pending handle intact when completionBatchResults rejects", async () => {
    const state = defaultState();
    const { provider } = makeProvider(new Map());
    const pending = await submitGlossarySuggestBatch(provider, SOURCES, [], 50, "m", root);
    provider.completionBatchResults = async () => { throw new Error("network timeout"); };
    await expect(applyGlossarySuggestBatchResults(() => state, () => {}, provider, pending, root, AI)).rejects.toThrow("network timeout");
    expect(loadPendingGlossaryBatch(root)).toBeDefined();
  });
});
