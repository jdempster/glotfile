import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultState } from "../schema.js";
import { createKey } from "../state.js";
import type { AiConfig, State } from "../schema.js";
import type { BatchJobOutcome, BatchJobSpec, BatchTranslationProvider, TranslationRequest } from "./provider.js";
import { buildBatchJobs, submitBatchTranslation, applyBatchResults } from "./batch-run.js";
import { loadPendingBatch } from "./pending-batch.js";
import { readLog } from "../log.js";
import { selectRequests } from "./run.js";

// Minimal two-key, three-locale state using the run.test.ts fixture style.
function makeState(): State {
  const s = defaultState();
  s.config.sourceLocale = "en";
  s.config.locales = ["en", "de", "fr"];
  createKey(s, "greeting", "Hello");
  createKey(s, "farewell", "Bye");
  return s;
}

function makeProvider(outcomes: Map<string, BatchJobOutcome>) {
  const seen: { jobs?: BatchJobSpec[]; syncBatches: TranslationRequest[][] } = { syncBatches: [] };
  const provider: BatchTranslationProvider = {
    supportsVision: () => false,
    complete: async () => ({}),
    // Sync path used by the malformed/failed fallback: echo a marker translation.
    translate: async (reqs, onBatchComplete) => {
      seen.syncBatches.push([...reqs]);
      const results = reqs.map((r) => ({ id: r.id, translation: `sync:${r.source}` }));
      onBatchComplete?.(reqs.length, reqs.length, results);
      return results;
    },
    submitTranslationBatch: async (jobs) => { seen.jobs = jobs; return "msgbatch_test"; },
    translationBatchStatus: async () => ({ status: "ended", counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 } }),
    translationBatchResults: async () => outcomes,
    cancelTranslationBatch: async () => {},
  };
  return { provider, seen };
}

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "glotfile-batchrun-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const AI: AiConfig = { provider: "anthropic", model: "claude-sonnet-4-6", endpoint: null, batchSize: 50 };

describe("buildBatchJobs", () => {
  it("groups by locale and chunks by batchSize with stable custom ids", () => {
    const state = makeState();
    const reqs = selectRequests(state, { onlyMissing: true });
    // 2 keys x 2 target locales = 4 requests; batchSize 1 -> 4 jobs.
    const jobs = buildBatchJobs(reqs, 1);
    expect(jobs).toHaveLength(4);
    expect(jobs.map((j) => j.customId)).toEqual(["de_0", "de_1", "fr_0", "fr_1"]);
    for (const job of jobs) expect(job.requests.every((r) => r.targetLocale === job.locale)).toBe(true);
  });

  it("produces custom ids accepted by the Anthropic batch API", () => {
    const reqs: TranslationRequest[] = [
      { id: "0", key: "k", source: "Hi", sourceLocale: "en", targetLocale: "pt-br", placeholders: [] },
      { id: "1", key: "k", source: "Hi", sourceLocale: "en", targetLocale: "sr@latin", placeholders: [] },
    ];
    const jobs = buildBatchJobs(reqs, 1);
    for (const job of jobs) expect(job.customId).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });
});

describe("submitBatchTranslation", () => {
  it("submits, persists the handle with source hashes, and strips images", async () => {
    const state = makeState();
    const reqs = selectRequests(state, { onlyMissing: true });
    reqs[0]!.image = { mediaType: "image/png", base64: "iVBOR" };
    const { provider } = makeProvider(new Map());
    const pending = await submitBatchTranslation(state, provider, reqs, 50, "claude-sonnet-4-6", root);
    expect(pending.batchId).toBe("msgbatch_test");
    const onDisk = loadPendingBatch(root)!;
    expect(onDisk.total).toBe(4);
    const stored = onDisk.jobs.flatMap((j) => j.requests);
    expect(stored.every((r) => typeof r.sourceHash === "string" && r.sourceHash.length > 0)).toBe(true);
    expect(stored.every((r) => !("image" in r))).toBe(true);
  });

  it("refuses when a batch is already pending", async () => {
    const state = makeState();
    const reqs = selectRequests(state, { onlyMissing: true });
    const { provider } = makeProvider(new Map());
    await submitBatchTranslation(state, provider, reqs, 50, "m", root);
    await expect(submitBatchTranslation(state, provider, reqs, 50, "m", root)).rejects.toThrow(/already pending/);
  });
});

describe("applyBatchResults", () => {
  async function submitted(state: State, batchSize = 50) {
    const reqs = selectRequests(state, { onlyMissing: true });
    const { provider } = makeProvider(new Map());
    return await submitBatchTranslation(state, provider, reqs, batchSize, "m", root);
  }

  it("applies parsed results and clears the handle", async () => {
    const state = makeState();
    const pending = await submitted(state);
    // One outcome per job, translating every request in it.
    const outcomes = new Map<string, BatchJobOutcome>(pending.jobs.map((j) => [
      j.customId,
      { type: "items", items: j.requests.map((r) => ({ id: r.id, translation: `T:${r.source}` })) },
    ]));
    const { provider } = makeProvider(outcomes);
    let persisted: State | null = null;
    const out = await applyBatchResults(() => state, (s) => { persisted = s; }, provider, pending, root, AI);
    expect(out.written).toBe(4);
    expect(out.staleSkipped).toBe(0);
    expect(persisted).not.toBeNull();
    expect(state.keys.greeting!.values.de?.value).toBe("T:Hello");
    expect(loadPendingBatch(root)).toBeUndefined();
  });

  it("skips results whose source changed since submit", async () => {
    const state = makeState();
    const pending = await submitted(state);
    // Edit one source after submit: its 2 results (de+fr) must be skipped.
    state.keys.greeting!.values.en = { value: "Hello there", state: "source" };
    const outcomes = new Map<string, BatchJobOutcome>(pending.jobs.map((j) => [
      j.customId,
      { type: "items", items: j.requests.map((r) => ({ id: r.id, translation: `T:${r.source}` })) },
    ]));
    const { provider } = makeProvider(outcomes);
    const out = await applyBatchResults(() => state, () => {}, provider, pending, root, AI);
    expect(out.staleSkipped).toBe(2);
    expect(out.written).toBe(2);
    expect(state.keys.greeting!.values.de?.value).toBeUndefined();
    expect(state.keys.farewell!.values.de?.value).toBe("T:Bye");
  });

  it("routes malformed and failed jobs through the sync fallback", async () => {
    const state = makeState();
    const pending = await submitted(state, 1);
    const outcomes = new Map<string, BatchJobOutcome>();
    for (const j of pending.jobs) {
      // de_1 = greeting/de (keys sort alphabetically: farewell < greeting, so
      // de_0=farewell, de_1=greeting); fr_0 = farewell/fr. Marking these as
      // malformed/failed retries exactly one greeting and one farewell request.
      if (j.customId === "de_1") outcomes.set(j.customId, { type: "malformed", raw: "{{{" });
      else if (j.customId === "fr_0") outcomes.set(j.customId, { type: "failed", error: "expired" });
      else outcomes.set(j.customId, { type: "items", items: j.requests.map((r) => ({ id: r.id, translation: `T:${r.source}` })) });
    }
    const { provider, seen } = makeProvider(outcomes);
    const out = await applyBatchResults(() => state, () => {}, provider, pending, root, AI);
    expect(out.retried).toBe(2);
    expect(out.written).toBe(4);
    expect(out.screenshotsSkipped).toBe(0);
    // Retried requests went through provider.translate (the sync path).
    expect(seen.syncBatches.flat().map((r) => r.key).sort()).toEqual(["farewell", "greeting"]);
    expect(state.keys.greeting!.values.de?.value).toBe("sync:Hello");
  });

  it("logs an apply entry carrying per-item errors, job failures, and stale keys", async () => {
    const state = defaultState();
    state.config.sourceLocale = "en";
    state.config.locales = ["en", "de", "fr"];
    createKey(state, "greeting", "Hello {name}");
    createKey(state, "farewell", "Bye");
    const reqs = selectRequests(state, { onlyMissing: true });
    const { provider: submitProvider } = makeProvider(new Map());
    const pending = await submitBatchTranslation(state, submitProvider, reqs, 50, "m", root);
    // Edit one source after submit so its results in every job count as stale.
    state.keys.farewell!.values.en = { value: "Bye now", state: "source" };
    const outcomes = new Map<string, BatchJobOutcome>();
    for (const j of pending.jobs) {
      // de: parsed reply whose greeting translation drops the placeholder;
      // fr: the whole job failed, sending its non-stale request to sync retry.
      if (j.locale === "de") {
        outcomes.set(j.customId, {
          type: "items",
          items: j.requests.map((r) => ({ id: r.id, translation: r.key === "greeting" ? "Hallo" : `T:${r.source}` })),
        });
      } else {
        outcomes.set(j.customId, { type: "failed", error: "expired" });
      }
    }
    const { provider } = makeProvider(outcomes);
    const out = await applyBatchResults(() => state, () => {}, provider, pending, root, AI);
    expect(out.errors).toEqual([{ key: "greeting", locale: "de", error: "Placeholder mismatch between source and translation." }]);

    const entry = readLog(root, 1)[0]!;
    expect(entry.summary).toBe(`Applied batch ${pending.batchId}: wrote 1, 1 error(s), 1 retried, 2 stale`);
    expect(entry.model).toBe("m");
    // Every applied request is itemized so results pair with their strings.
    expect(entry.items?.map((i) => `${i.key}@${i.targetLocale}`).sort()).toEqual(["greeting@de", "greeting@fr"]);
    expect(entry.results?.some((r) => r.error?.includes("Placeholder mismatch"))).toBe(true);
    expect(entry.jobFailures).toEqual([{ customId: "fr_0", locale: "fr", type: "failed", error: "expired" }]);
    expect(entry.stale).toEqual([
      { key: "farewell", locale: "de" },
      { key: "farewell", locale: "fr" },
    ]);
  });

  it("logs token usage and a batch-discounted estimated cost", async () => {
    const state = makeState();
    // Pricing keys off the model recorded at submit time, so use a real one.
    const reqs = selectRequests(state, { onlyMissing: true });
    const { provider: submitProvider } = makeProvider(new Map());
    const pending = await submitBatchTranslation(state, submitProvider, reqs, 50, "claude-sonnet-4-6", root);
    const outcomes = new Map<string, BatchJobOutcome>(pending.jobs.map((j) => [
      j.customId,
      { type: "items", items: j.requests.map((r) => ({ id: r.id, translation: `T:${r.source}` })) },
    ]));
    const { provider } = makeProvider(outcomes);
    // Simulate the provider accumulating usage during the results fetch:
    // first drain (pre-fetch reset) empty, second drain returns the batch usage.
    const drained = [undefined, { inputTokens: 1_000_000, outputTokens: 100_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }];
    provider.takeUsage = () => drained.shift() ?? undefined;
    await applyBatchResults(() => state, () => {}, provider, pending, root, AI);

    const entry = readLog(root, 1)[0]!;
    expect(entry.usage).toEqual({ inputTokens: 1_000_000, outputTokens: 100_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    // Sonnet 4.6 at $3/$15 per MTok, halved for batch: (3 + 1.5) * 0.5 = 2.25.
    expect(entry.estimatedCostUsd).toBeCloseTo(2.25);
    expect(entry.summary).toContain("(~$2.25)");
  });

  it("leaves the pending handle intact when translationBatchResults rejects", async () => {
    const state = makeState();
    const pending = await submitted(state);
    // Provider whose results call always rejects — simulates a network error
    // or a provider outage after the batch completes.
    const failingProvider: BatchTranslationProvider = {
      supportsVision: () => false,
      complete: async () => ({}),
      translate: async () => [],
      submitTranslationBatch: async () => "msgbatch_test",
      translationBatchStatus: async () => ({ status: "ended", counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 } }),
      translationBatchResults: async () => { throw new Error("network timeout"); },
      cancelTranslationBatch: async () => {},
    };
    await expect(
      applyBatchResults(() => state, () => {}, failingProvider, pending, root, AI),
    ).rejects.toThrow("network timeout");
    // The handle must still be present so the caller can retry.
    expect(loadPendingBatch(root)).toBeDefined();
  });
});
