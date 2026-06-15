import type { AiConfig, State } from "../schema.js";
import type { BatchJobSpec, BatchTranslationProvider, TranslationRequest, TranslationResult } from "./provider.js";
import { sourceHash } from "../lint/suppress.js";
import { chunk, validateReply } from "./batch.js";
import { applyResults, attachScreenshotsForProvider, runLocaleParallel } from "./run.js";
import { loadPendingBatch, savePendingBatch, clearPendingBatch, type PendingBatch, type StoredRequest } from "./pending-batch.js";
import { appendLog, type AiLogJobFailure } from "../log.js";
import { addUsage, estimateUsageCostUsd, resolvePricing, BATCH_PRICE_MULTIPLIER, type TokenUsage } from "./pricing.js";

// Same grouping as runLocaleParallel: a job is always single-locale so the
// prompt can name one target language. customId is stable and human-readable
// for log/debug purposes; uniqueness comes from locale + chunk index.
// Anthropic requires custom_id to match ^[a-zA-Z0-9_-]{1,64}$, so the locale
// part is sanitized and the chunk index joined with "_" (canonical BCP-47
// locales never contain underscores, so ids stay unique per locale+chunk).
export function buildBatchJobs(reqs: TranslationRequest[], batchSize: number): BatchJobSpec[] {
  const byLocale = new Map<string, TranslationRequest[]>();
  for (const req of reqs) {
    let group = byLocale.get(req.targetLocale);
    if (!group) { group = []; byLocale.set(req.targetLocale, group); }
    group.push(req);
  }
  const jobs: BatchJobSpec[] = [];
  for (const [locale, group] of byLocale) {
    chunk(group, Math.max(1, batchSize)).forEach((batch, i) => {
      const safeLocale = locale.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 56);
      jobs.push({ customId: `${safeLocale}_${i}`, locale, requests: batch });
    });
  }
  return jobs;
}

export async function submitBatchTranslation(
  state: State,
  provider: BatchTranslationProvider,
  reqs: TranslationRequest[],
  batchSize: number,
  model: string,
  projectRoot: string,
): Promise<PendingBatch> {
  if (loadPendingBatch(projectRoot)) {
    throw new Error("A translation batch is already pending. Apply or cancel it first (`glotfile batch`).");
  }
  const jobs = buildBatchJobs(reqs, batchSize);
  const batchId = await provider.submitTranslationBatch(jobs);
  const pending: PendingBatch = {
    version: 1,
    // Only Anthropic implements batch translation today.
    provider: "anthropic",
    model,
    batchId,
    createdAt: new Date().toISOString(),
    total: reqs.length,
    jobs: jobs.map((j) => ({
      customId: j.customId,
      locale: j.locale,
      requests: j.requests.map((r) => {
        // Drop image bytes — base64 would bloat the file; the sync-fallback
        // retry re-attaches them from state at apply time.
        const { image: _image, ...rest } = r;
        return { ...rest, sourceHash: sourceHash(state.keys[r.key]!, state.config.sourceLocale) };
      }),
    })),
  };
  savePendingBatch(projectRoot, pending);
  return pending;
}

export interface ApplyBatchOutcome {
  written: number;
  errors: Array<{ key: string; locale: string; error: string }>;
  // Results dropped because the key was deleted/renamed or its source edited
  // between submit and apply.
  staleSkipped: number;
  // Requests re-run through the synchronous path because their batch entry
  // came back malformed, errored, or expired.
  retried: number;
  // Screenshots dropped on retry because the model lacks vision.
  screenshotsSkipped: number;
}

export async function applyBatchResults(
  load: () => State,
  persist: (s: State) => void,
  provider: BatchTranslationProvider,
  pending: PendingBatch,
  projectRoot: string,
  ai: AiConfig,
): Promise<ApplyBatchOutcome> {
  provider.takeUsage?.();
  const outcomes = await provider.translationBatchResults(pending.batchId);
  // Batch-fetched usage bills at the batch discount; any sync-retry usage
  // (drained separately below) bills at the full synchronous price.
  const batchUsage = provider.takeUsage?.();
  // Load fresh so edits made while the batch was processing are respected;
  // staleness is judged against the CURRENT state, not the submit-time one.
  const fresh = load();

  const isStale = (r: StoredRequest): boolean => {
    const entry = fresh.keys[r.key];
    return !entry || sourceHash(entry, fresh.config.sourceLocale) !== r.sourceHash;
  };

  const applied: TranslationRequest[] = [];
  const results: TranslationResult[] = [];
  const retryReqs: TranslationRequest[] = [];
  const stale: Array<{ key: string; locale: string }> = [];
  const jobFailures: AiLogJobFailure[] = [];

  for (const job of pending.jobs) {
    const outcome = outcomes.get(job.customId);
    // Only "items" outcomes carry parsed results; malformed and failed go to retry.
    const itemsById = outcome?.type === "items" ? new Map(outcome.items.map((i) => [i.id, i])) : null;
    if (!itemsById) {
      if (!outcome) jobFailures.push({ customId: job.customId, locale: job.locale, type: "missing" });
      else if (outcome.type === "malformed") jobFailures.push({ customId: job.customId, locale: job.locale, type: "malformed", raw: outcome.raw });
      else if (outcome.type === "failed") jobFailures.push({ customId: job.customId, locale: job.locale, type: "failed", error: outcome.error });
    }
    for (const stored of job.requests) {
      if (isStale(stored)) { stale.push({ key: stored.key, locale: stored.targetLocale }); continue; }
      const { sourceHash: _hash, ...req } = stored;
      if (!itemsById) { retryReqs.push(req); continue; }
      applied.push(req);
      results.push(validateReply(req, itemsById.get(req.id)));
    }
  }

  // Malformed/failed entries fall back to the synchronous path, which already
  // bisect-retries malformed replies; screenshots are re-attached from state
  // because the pending file deliberately drops image bytes.
  let screenshotsSkipped = 0;
  if (retryReqs.length) {
    const { skipped } = attachScreenshotsForProvider(retryReqs, fresh, projectRoot, provider.supportsVision());
    screenshotsSkipped = skipped;
    const retryResults = await runLocaleParallel(
      retryReqs,
      provider,
      {
        // Record the raw reply so an unparseable retry response is diagnosable
        // from the activity log instead of vanishing into per-item errors.
        onMalformedReply: (raw, batchSize, locale) => {
          appendLog(projectRoot, {
            at: new Date().toISOString(),
            kind: "translate",
            summary: `Malformed model reply (${locale}, batch of ${batchSize})`,
            model: pending.model,
            locale,
            raw,
          });
        },
      },
      ai.concurrency,
      undefined,
      ai.batchSize,
    );
    applied.push(...retryReqs);
    results.push(...retryResults);
  }
  const retryUsage = provider.takeUsage?.();

  // Cost the two billing paths at their own rates, then merge for the log.
  const pricing = resolvePricing({ ...ai, model: pending.model });
  let estimatedCostUsd: number | undefined;
  if (pricing && (batchUsage || retryUsage)) {
    estimatedCostUsd =
      (batchUsage ? estimateUsageCostUsd(batchUsage, pricing, BATCH_PRICE_MULTIPLIER) : 0) +
      (retryUsage ? estimateUsageCostUsd(retryUsage, pricing) : 0);
  }
  let usage: TokenUsage | undefined;
  if (batchUsage || retryUsage) {
    usage = batchUsage ?? { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    if (retryUsage) addUsage(usage, retryUsage);
  }

  const { written, errors } = applyResults(fresh, applied, results);
  // The handle is cleared only after a successful persist, so a throw anywhere
  // earlier leaves the batch resumable.
  persist(fresh);
  clearPendingBatch(projectRoot);
  // Items repeat only id/key/source/locale (the submit entry already logged
  // context/glossary) — enough for the activity view to pair each result with
  // its string and make per-item errors like placeholder mismatches readable.
  const costSuffix = estimatedCostUsd !== undefined ? ` (~$${estimatedCostUsd.toFixed(2)})` : "";
  appendLog(projectRoot, {
    at: new Date().toISOString(),
    kind: "translate",
    summary: `Applied batch ${pending.batchId}: wrote ${written}, ${errors.length} error(s), ${retryReqs.length} retried, ${stale.length} stale${costSuffix}`,
    model: pending.model,
    items: applied.map((r) => ({ id: r.id, key: r.key, source: r.source, targetLocale: r.targetLocale })),
    results,
    jobFailures: jobFailures.length ? jobFailures : undefined,
    stale: stale.length ? stale : undefined,
    usage,
    estimatedCostUsd,
  });
  return { written, errors, staleSkipped: stale.length, retried: retryReqs.length, screenshotsSkipped };
}
