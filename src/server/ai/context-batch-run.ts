import type { AiConfig, State } from "../schema.js";
import type { BatchCompletionProvider, CompletionRequest } from "./provider.js";
import {
  buildContextSystemPrompt, buildContextBatchPrompt, CONTEXT_BATCH_SCHEMA,
  applyContext, type ContextRequest, type ContextGuidance,
} from "./context.js";
import {
  loadPendingContextBatch, savePendingContextBatch, clearPendingContextBatch,
  type PendingContextBatch, type StoredContextRequest,
} from "./pending-context-batch.js";
import { appendLog, type AiLogJobFailure } from "../log.js";
import { addUsage, estimateUsageCostUsd, resolvePricing, BATCH_PRICE_MULTIPLIER, type TokenUsage } from "./pricing.js";

interface ContextReplyItem {
  id: string;
  context?: string;
  error?: string;
}

function completionRequestFor(chunk: ContextRequest[], guidance: ContextGuidance): CompletionRequest {
  return {
    system: buildContextSystemPrompt(guidance),
    content: [{ type: "text", text: buildContextBatchPrompt(chunk) }],
    schema: CONTEXT_BATCH_SCHEMA,
  };
}

export async function submitContextBatch(
  provider: BatchCompletionProvider,
  targets: ContextRequest[],
  batchSize: number,
  model: string,
  projectRoot: string,
  force: boolean,
  guidance: ContextGuidance = {},
): Promise<PendingContextBatch> {
  if (loadPendingContextBatch(projectRoot)) {
    throw new Error("A context batch is already pending. Apply or cancel it first.");
  }
  const chunks: ContextRequest[][] = [];
  const size = Math.max(1, batchSize);
  for (let i = 0; i < targets.length; i += size) chunks.push(targets.slice(i, i + size));
  const jobs = chunks.map((chunk, i) => ({ customId: `ctx_${i}`, chunk }));
  const batchId = await provider.submitCompletionBatch(
    jobs.map((j) => ({ customId: j.customId, request: completionRequestFor(j.chunk, guidance) })),
  );
  const pending: PendingContextBatch = {
    version: 1,
    // Only Anthropic implements completion batches today.
    provider: "anthropic",
    model,
    batchId,
    createdAt: new Date().toISOString(),
    total: targets.length,
    force,
    guidance,
    jobs: jobs.map((j) => ({
      customId: j.customId,
      requests: j.chunk.map(({ image: _image, ...rest }): StoredContextRequest => rest),
    })),
  };
  savePendingContextBatch(projectRoot, pending);
  return pending;
}

export interface ApplyContextBatchOutcome {
  written: number;
  errors: Array<{ key: string; error: string }>;
  // Jobs re-run through the synchronous path because their batch entry came
  // back malformed, errored, or expired.
  retried: number;
}

export async function applyContextBatchResults(
  load: () => State,
  persist: (s: State) => void,
  provider: BatchCompletionProvider,
  pending: PendingContextBatch,
  projectRoot: string,
  ai: AiConfig,
): Promise<ApplyContextBatchOutcome> {
  provider.takeUsage?.();
  const outcomes = await provider.completionBatchResults(pending.batchId);
  // Batch-fetched usage bills at the batch discount; any sync-retry usage
  // (drained separately below) bills at the full synchronous price.
  const batchUsage = provider.takeUsage?.();

  const applied: StoredContextRequest[] = [];
  const items: ContextReplyItem[] = [];
  const errors: Array<{ key: string; error: string }> = [];
  const jobFailures: AiLogJobFailure[] = [];
  const retryChunks: StoredContextRequest[][] = [];

  for (const job of pending.jobs) {
    const outcome = outcomes.get(job.customId);
    if (outcome?.type === "json") {
      const batch = outcome.value as { items?: ContextReplyItem[] };
      applied.push(...job.requests);
      items.push(...(batch.items ?? []));
      continue;
    }
    if (!outcome) jobFailures.push({ customId: job.customId, locale: "", type: "missing" });
    else if (outcome.type === "malformed") jobFailures.push({ customId: job.customId, locale: "", type: "malformed", raw: outcome.raw });
    else jobFailures.push({ customId: job.customId, locale: "", type: "failed", error: outcome.error });
    retryChunks.push(job.requests);
  }

  // Malformed/failed jobs fall back to the synchronous path, one call per
  // original chunk, so a single bad batch entry never sinks the run.
  for (const chunk of retryChunks) {
    try {
      const raw = await provider.complete(completionRequestFor(chunk, pending.guidance ?? {}));
      const batch = raw as { items?: ContextReplyItem[] };
      applied.push(...chunk);
      items.push(...(batch.items ?? []));
    } catch (e) {
      errors.push(...chunk.map((t) => ({ key: t.key, error: (e as Error).message })));
    }
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

  // Load fresh so edits made while the batch was processing are respected;
  // applyContext itself skips deleted keys and (without force) keys that
  // gained context in the meantime.
  const fresh = load();
  const { written, errors: applyErrors } = applyContext(fresh, applied, items, pending.force);
  errors.push(...applyErrors);
  // The handle is cleared only after a successful persist, so a throw anywhere
  // earlier leaves the batch resumable.
  persist(fresh);
  clearPendingContextBatch(projectRoot);
  const costSuffix = estimatedCostUsd !== undefined ? ` (~$${estimatedCostUsd.toFixed(2)})` : "";
  appendLog(projectRoot, {
    at: new Date().toISOString(),
    kind: "context",
    summary: `Applied context batch ${pending.batchId}: wrote ${written}, ${errors.length} error(s), ${retryChunks.length} job(s) retried${costSuffix}`,
    model: pending.model,
    items: applied.map((r) => ({ id: r.id, key: r.key, source: r.source })),
    results: items.map((r) => ({ id: r.id, value: r.context, error: r.error })),
    jobFailures: jobFailures.length ? jobFailures : undefined,
    usage,
    estimatedCostUsd,
  });
  return { written, errors, retried: retryChunks.length };
}
