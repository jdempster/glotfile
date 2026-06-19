import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import type { State } from "../schema.js";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "./provider.js";
import { matchGlossary, matchGlossaryForms, glossaryHints } from "../glossary.js";
import { extractPlaceholders, quotedLiterals } from "../placeholders.js";
import { categoriesFor } from "../plurals.js";
import { applyMachineTranslation, applyMachineTranslationForms } from "../state.js";
import { cellState, type EffectiveState } from "../cell-state.js";
import { globToRegExp } from "../glob.js";
import { chunk } from "./batch.js";

export interface SelectOptions {
  onlyMissing?: boolean;
  // Restrict to targets currently in one of these effective states. Takes
  // precedence over onlyMissing when set (used by `translate --state`); e.g.
  // ["needs-review"] re-translates only the strings a source edit invalidated.
  states?: EffectiveState[];
  locales?: string[];
  keyGlob?: string;
  keys?: string[];
}

export function selectRequests(state: State, opts: SelectOptions): TranslationRequest[] {
  const targets = (opts.locales ?? state.config.locales).filter((l) => l !== state.config.sourceLocale);
  const keyRe = opts.keyGlob ? globToRegExp(opts.keyGlob) : null;
  const keySet = opts.keys ? new Set(opts.keys) : null;
  const stateSet = opts.states ? new Set(opts.states) : null;
  // Skip a target unless it passes the active selector: an explicit state set
  // wins; otherwise the legacy onlyMissing boolean (keep only "missing").
  const skip = (st: EffectiveState) => (stateSet ? !stateSet.has(st) : !!opts.onlyMissing && st !== "missing");
  const reqs: TranslationRequest[] = [];
  // Config-driven AI guidance, carried on every request so the prompt builder
  // can inject it without the providers ever seeing the project Config.
  const projectContext = state.config.projectContext?.trim() || undefined;
  const localeInstructionFor = (locale: string) => state.config.localeInstructions?.[locale]?.trim() || undefined;
  let id = 0;
  for (const key of Object.keys(state.keys).sort()) {
    const entry = state.keys[key]!;
    if (entry.skipTranslate) continue;
    if (keyRe && !keyRe.test(key)) continue;
    if (keySet && !keySet.has(key)) continue;
    const sourceLv = entry.values[state.config.sourceLocale];
    if (entry.plural) {
      const sourceForms = sourceLv?.forms;
      // The "other" form is the representative source string for per-form
      // placeholder validation; glossary relevance scans EVERY form so a term
      // appearing only in (say) the `one` form still constrains the result.
      const other = sourceForms?.other;
      if (!sourceForms || !other) continue;
      const matches = matchGlossaryForms(
        Object.values(sourceForms).filter((f): f is string => !!f),
        state.glossary,
      );
      const literals = quotedLiterals(other);
      for (const locale of targets) {
        // A plural target is "missing" when it lacks any required category for
        // that locale (an empty form counts as missing) — so converting a
        // scalar (which seeds only `other`) still leaves the rest translatable.
        if (skip(cellState(entry, locale, state.config.sourceLocale))) continue;
        const glossary = glossaryHints(matches, locale);
        reqs.push({
          id: String(id++),
          key,
          source: other,
          sourceLocale: state.config.sourceLocale,
          context: entry.context,
          targetLocale: locale,
          maxLength: entry.maxLength,
          placeholders: extractPlaceholders(other),
          ...(literals.length ? { literals } : {}),
          ...(glossary.length ? { glossary } : {}),
          ...(projectContext ? { projectContext } : {}),
          ...(localeInstructionFor(locale) ? { localeInstruction: localeInstructionFor(locale) } : {}),
          plural: { arg: entry.plural.arg, categories: categoriesFor(locale), sourceForms },
        });
      }
      continue;
    }
    const source = sourceLv?.value;
    if (!source) continue;
    // Glossary relevance is locale-independent — match once, shape per locale.
    const matches = matchGlossary(source, state.glossary);
    const literals = quotedLiterals(source);
    for (const locale of targets) {
      if (skip(cellState(entry, locale, state.config.sourceLocale))) continue;
      const glossary = glossaryHints(matches, locale);
      reqs.push({
        id: String(id++),
        key,
        source,
        sourceLocale: state.config.sourceLocale,
        context: entry.context,
        targetLocale: locale,
        maxLength: entry.maxLength,
        placeholders: extractPlaceholders(source),
        ...(literals.length ? { literals } : {}),
        ...(glossary.length ? { glossary } : {}),
        ...(projectContext ? { projectContext } : {}),
        ...(localeInstructionFor(locale) ? { localeInstruction: localeInstructionFor(locale) } : {}),
      });
    }
  }
  return reqs;
}

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function attachScreenshots(reqs: TranslationRequest[], state: State, projectRoot: string): void {
  // Reading the same file once per locale would be wasteful; cache by path.
  const cache = new Map<string, { mediaType: string; base64: string } | null>();
  for (const req of reqs) {
    const screenshot = state.keys[req.key]?.screenshot;
    if (!screenshot) continue;
    const mediaType = MEDIA_TYPES[extname(screenshot).toLowerCase()];
    if (!mediaType) continue;
    if (!cache.has(screenshot)) {
      const abs = resolve(projectRoot, screenshot);
      if (!existsSync(abs)) {
        cache.set(screenshot, null);
      } else {
        const buf = readFileSync(abs);
        cache.set(screenshot, buf.length > MAX_IMAGE_BYTES ? null : { mediaType, base64: buf.toString("base64") });
      }
    }
    const image = cache.get(screenshot);
    if (image) req.image = image;
  }
}

// Attach screenshots only if the configured model can see them. When it can't
// (e.g. a Meta Llama text model on Bedrock), skip the image reads entirely and
// report how many distinct keys carried a screenshot, so the caller can warn.
export function attachScreenshotsForProvider(
  reqs: TranslationRequest[],
  state: State,
  projectRoot: string,
  supportsVision: boolean,
): { skipped: number } {
  if (supportsVision) {
    attachScreenshots(reqs, state, projectRoot);
    return { skipped: 0 };
  }
  const keys = new Set(reqs.filter((r) => state.keys[r.key]?.screenshot).map((r) => r.key));
  return { skipped: keys.size };
}

const DEFAULT_LOCALE_CONCURRENCY = 3;

// Lifecycle hooks for a parallel run. onLocaleStart fires the instant a worker
// picks up a locale — before its first LLM call — so callers can show "this
// language is in flight" without waiting ~10-40s for the first batch to return.
// onBatchComplete fires after each batch with the shared global done/total
// counter plus that batch's locale; onLocaleDone fires when a locale's group
// finishes (skipped if the run was aborted mid-locale).
export interface RunHooks {
  onLocaleStart?: (locale: string) => void;
  onBatchComplete?: (done: number, total: number, batchResults: TranslationResult[], locale: string) => void;
  onLocaleDone?: (locale: string) => void;
  // Fires each time a (sub-)batch's model reply could not be parsed — before
  // it is bisected and retried — so callers can log the raw reply text.
  onMalformedReply?: (raw: string, batchSize: number, locale: string) => void;
  // Fires before a transient provider error (429/5xx/network) is retried, so
  // callers can surface "retrying language X (attempt N)".
  onRetry?: (locale: string, attempt: number, error: unknown) => void;
}

// Retry policy for transient provider failures in runLocaleParallel.
export interface RetryOptions {
  retries?: number;
  delayMs?: (attempt: number) => number;
}

// A provider error worth retrying: HTTP 429/5xx or a transient network error.
// 4xx (other than 429) is a request problem and must not be retried.
function isTransientError(err: unknown): boolean {
  const e = err as { status?: number; code?: string } | null;
  if (e && typeof e.status === "number") return e.status === 429 || e.status >= 500;
  const code = e?.code;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "EPIPE" || code === "EAI_AGAIN";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); resolve(); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Schedules every batch through ONE shared pool of `concurrency` workers, so
// `concurrency` is the total number of simultaneous provider requests — it maps
// directly to the provider's rate limit regardless of how many locales there
// are or how the keys are distributed across them. Batches are pre-chunked here
// (a batch is always single-locale: the prompt names one target language) and
// interleaved round-robin across locales so the pool spreads across languages
// first, rather than draining one locale before the next.
//
// `batchSize` is the chunk size; the default (Infinity) yields one batch per
// locale, reproducing the old one-call-per-locale behaviour, so callers that
// don't pass it (e.g. tests) keep the previous semantics. Pass the configured
// ai.batchSize to actually parallelize a locale's batches.
//
// Hooks receive a shared global done/total counter. onLocaleStart fires when a
// worker picks up a locale's first batch; onLocaleDone fires when its last
// batch finishes (skipped if the run was aborted mid-locale).
export async function runLocaleParallel(
  reqs: TranslationRequest[],
  provider: TranslationProvider,
  hooks: RunHooks = {},
  concurrency = DEFAULT_LOCALE_CONCURRENCY,
  signal?: AbortSignal,
  batchSize = Infinity,
  retry: RetryOptions = {},
): Promise<TranslationResult[]> {
  if (!reqs.length) return [];

  const maxRetries = retry.retries ?? 3;
  const delayMs = retry.delayMs ?? ((attempt: number) => 250 * 2 ** attempt);

  // Group by locale, preserving insertion order, then chunk each into batches.
  const byLocale = new Map<string, TranslationRequest[]>();
  for (const req of reqs) {
    let group = byLocale.get(req.targetLocale);
    if (!group) { group = []; byLocale.set(req.targetLocale, group); }
    group.push(req);
  }
  const localeBatches = [...byLocale.entries()].map(([locale, group]) => ({
    locale,
    batches: chunk(group, Math.max(1, batchSize)),
  }));

  // Round-robin interleave: [loc0#0, loc1#0, …, loc0#1, loc1#1, …].
  const jobs: Array<{ locale: string; batch: TranslationRequest[] }> = [];
  const maxBatches = Math.max(...localeBatches.map((g) => g.batches.length));
  for (let i = 0; i < maxBatches; i++) {
    for (const g of localeBatches) {
      if (i < g.batches.length) jobs.push({ locale: g.locale, batch: g.batches[i]! });
    }
  }

  // Remaining batch count per locale drives onLocaleDone; `started` makes
  // onLocaleStart fire exactly once, the first time any of its batches runs.
  const remaining = new Map(localeBatches.map((g) => [g.locale, g.batches.length] as const));
  const started = new Set<string>();
  const total = reqs.length;
  let done = 0;
  const allResults: TranslationResult[] = [];
  let next = 0;

  async function worker() {
    while (next < jobs.length) {
      if (signal?.aborted) break;
      const { locale, batch } = jobs[next++]!;
      if (!started.has(locale)) { started.add(locale); hooks.onLocaleStart?.(locale); }
      // Retry transient provider failures (429/5xx/network) so one rate-limit hit
      // doesn't reject the whole multi-locale run; non-transient errors propagate.
      let batchResults: TranslationResult[] | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          batchResults = await provider.translate(batch, (_localeDone, _localeTotal, results) => {
            done += results.length;
            hooks.onBatchComplete?.(done, total, results, locale);
          }, signal, (raw, size) => hooks.onMalformedReply?.(raw, size, locale));
          break;
        } catch (err) {
          if (attempt >= maxRetries || signal?.aborted || !isTransientError(err)) throw err;
          hooks.onRetry?.(locale, attempt + 1, err);
          await sleep(delayMs(attempt), signal);
        }
      }
      allResults.push(...batchResults);
      const left = remaining.get(locale)! - 1;
      remaining.set(locale, left);
      if (left === 0 && !signal?.aborted) hooks.onLocaleDone?.(locale);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, worker);
  await Promise.all(workers);

  return allResults;
}

export function applyResults(
  state: State,
  reqs: TranslationRequest[],
  results: TranslationResult[],
  force = false,
): { written: number; errors: Array<{ key: string; locale: string; error: string }> } {
  const byId = new Map(reqs.map((r) => [r.id, r]));
  let written = 0;
  const errors: Array<{ key: string; locale: string; error: string }> = [];
  for (const res of results) {
    const req = byId.get(res.id);
    if (!req) continue;
    if (req.plural) {
      if (res.error || res.forms === undefined) {
        errors.push({ key: req.key, locale: req.targetLocale, error: res.error ?? "no translation" });
        continue;
      }
      if (applyMachineTranslationForms(state, req.key, req.targetLocale, res.forms, force)) written++;
      continue;
    }
    if (res.translation === undefined) {
      errors.push({ key: req.key, locale: req.targetLocale, error: res.error ?? "no translation" });
      continue;
    }
    if (res.error) errors.push({ key: req.key, locale: req.targetLocale, error: res.error });
    if (applyMachineTranslation(state, req.key, req.targetLocale, res.translation, force)) written++;
  }
  return { written, errors };
}
