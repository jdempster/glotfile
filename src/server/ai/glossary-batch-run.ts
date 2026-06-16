import type { AiConfig, State } from "../schema.js";
import type { BatchCompletionProvider, CompletionRequest } from "./provider.js";
import {
  buildGlossarySuggestSystemPrompt, buildGlossarySuggestBatchPrompt, GLOSSARY_SUGGEST_SCHEMA,
  dedupeTerms, type GlossarySource, type SuggestedTerm,
} from "./glossary-suggest.js";
import {
  loadPendingGlossaryBatch, savePendingGlossaryBatch, clearPendingGlossaryBatch,
  type PendingGlossaryBatch,
} from "./pending-glossary-batch.js";
import { mergeGlossarySuggestions } from "../state.js";
import { appendLog, type AiLogJobFailure } from "../log.js";
import { addUsage, estimateUsageCostUsd, resolvePricing, BATCH_PRICE_MULTIPLIER, type TokenUsage } from "./pricing.js";

function completionRequestFor(chunk: GlossarySource[], knownTerms: string[]): CompletionRequest {
  return {
    system: buildGlossarySuggestSystemPrompt(),
    content: [{ type: "text", text: buildGlossarySuggestBatchPrompt(chunk, knownTerms) }],
    schema: GLOSSARY_SUGGEST_SCHEMA,
  };
}

export async function submitGlossarySuggestBatch(
  provider: BatchCompletionProvider,
  sources: GlossarySource[],
  knownTerms: string[],
  batchSize: number,
  model: string,
  projectRoot: string,
): Promise<PendingGlossaryBatch> {
  if (loadPendingGlossaryBatch(projectRoot)) {
    throw new Error("A glossary suggestion batch is already pending. Apply or cancel it first.");
  }
  const chunks: GlossarySource[][] = [];
  const size = Math.max(1, batchSize);
  for (let i = 0; i < sources.length; i += size) chunks.push(sources.slice(i, i + size));
  const jobs = chunks.map((chunk, i) => ({ customId: `gloss_${i}`, chunk }));
  const batchId = await provider.submitCompletionBatch(
    jobs.map((j) => ({ customId: j.customId, request: completionRequestFor(j.chunk, knownTerms) })),
  );
  const pending: PendingGlossaryBatch = {
    version: 1,
    // Only Anthropic implements completion batches today.
    provider: "anthropic",
    model,
    batchId,
    createdAt: new Date().toISOString(),
    total: sources.length,
    knownTerms,
    jobs: jobs.map((j) => ({
      customId: j.customId,
      requests: j.chunk,
    })),
  };
  savePendingGlossaryBatch(projectRoot, pending);
  return pending;
}

export interface ApplyGlossarySuggestBatchOutcome {
  added: number;
  // Chunk-level errors, not per-key: a failed batch chunk spans many source
  // strings, so (unlike context's per-key errors) there's no single key to blame.
  errors: Array<{ error: string }>;
  // Jobs re-run through the synchronous path because their batch entry came
  // back malformed, errored, or expired.
  retried: number;
}

export async function applyGlossarySuggestBatchResults(
  load: () => State,
  persist: (s: State) => void,
  provider: BatchCompletionProvider,
  pending: PendingGlossaryBatch,
  projectRoot: string,
  ai: AiConfig,
): Promise<ApplyGlossarySuggestBatchOutcome> {
  provider.takeUsage?.();
  const outcomes = await provider.completionBatchResults(pending.batchId);
  // Batch-fetched usage bills at the batch discount; any sync-retry usage
  // (drained separately below) bills at the full synchronous price.
  const batchUsage = provider.takeUsage?.();

  const allTerms: SuggestedTerm[] = [];
  const errors: Array<{ error: string }> = [];
  const jobFailures: AiLogJobFailure[] = [];
  const retryChunks: GlossarySource[][] = [];

  for (const job of pending.jobs) {
    const outcome = outcomes.get(job.customId);
    if (outcome?.type === "json") {
      const batch = outcome.value as { terms?: SuggestedTerm[] };
      allTerms.push(...(batch.terms ?? []));
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
      const raw = await provider.complete(completionRequestFor(chunk, pending.knownTerms));
      const batch = raw as { terms?: SuggestedTerm[] };
      allTerms.push(...(batch.terms ?? []));
    } catch (e) {
      errors.push({ error: (e as Error).message });
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

  // Load fresh so edits made while the batch was processing are respected.
  const fresh = load();
  const added = mergeGlossarySuggestions(fresh, dedupeTerms(allTerms));
  // The handle is cleared only after a successful persist, so a throw anywhere
  // earlier leaves the batch resumable.
  persist(fresh);
  clearPendingGlossaryBatch(projectRoot);
  const costSuffix = estimatedCostUsd !== undefined ? ` (~$${estimatedCostUsd.toFixed(2)})` : "";
  appendLog(projectRoot, {
    at: new Date().toISOString(),
    kind: "glossary",
    summary: `Applied glossary suggestion batch ${pending.batchId}: ${added.length} new term(s), ${errors.length} error(s), ${retryChunks.length} job(s) retried${costSuffix}`,
    model: pending.model,
    jobFailures: jobFailures.length ? jobFailures : undefined,
    usage,
    estimatedCostUsd,
  });
  return { added: added.length, errors, retried: retryChunks.length };
}
