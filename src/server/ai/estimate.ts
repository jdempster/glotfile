import type { AiConfig, State } from "../schema.js";
import { selectRequests, type SelectOptions } from "./run.js";
import { buildSystemPrompt, buildBatchPrompt, type TranslationRequest } from "./provider.js";
import { chunk } from "./batch.js";
import { resolvePricing, type ResolvedPricing } from "./pricing.js";

export interface LocaleEstimate {
  locale: string;
  requests: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
}

export interface TranslationEstimate {
  requests: number;
  batches: number;
  perLocale: LocaleEstimate[];
  inputTokens: number;
  outputTokens: number;
  pricing: ResolvedPricing | null;
  estimatedCost: number | null;
}

// chars/4 is a serviceable cross-provider approximation for Latin-script text;
// CJK scripts tokenize far denser (~1 token per 1-2 chars), so weight them
// higher. The whole estimate is presented to users as ±20%.
const CJK_RE = /[　-鿿가-힯豈-﫿]/g;

export function estimateTokens(text: string): number {
  const cjk = text.match(CJK_RE)?.length ?? 0;
  return Math.ceil((text.length - cjk) / 4 + cjk / 2);
}

// Translations average slightly longer than their source; the JSON reply
// envelope ({"id":…,"translation":…}) adds a fixed per-item overhead.
const EXPANSION = 1.2;
const ITEM_REPLY_OVERHEAD = 16;
const FORM_REPLY_OVERHEAD = 8;

function estimateOutputTokens(req: TranslationRequest): number {
  const translated = Math.ceil(estimateTokens(req.source) * EXPANSION);
  if (req.plural) {
    return ITEM_REPLY_OVERHEAD + req.plural.categories.length * (translated + FORM_REPLY_OVERHEAD);
  }
  return ITEM_REPLY_OVERHEAD + translated;
}

// Mirrors a real run exactly: selectRequests → group by locale → chunk by
// batchSize → one system prompt + one batch prompt per LLM call. The prompts
// are rendered with the same builders the providers use, so the only error
// source is the chars→tokens heuristic. Screenshots are NOT attached: vision
// image tokens are excluded from the estimate.
export function estimateTranslation(state: State, ai: AiConfig, opts: SelectOptions): TranslationEstimate {
  const reqs = selectRequests(state, opts);
  const byLocale = new Map<string, TranslationRequest[]>();
  for (const r of reqs) {
    let group = byLocale.get(r.targetLocale);
    if (!group) { group = []; byLocale.set(r.targetLocale, group); }
    group.push(r);
  }
  const perLocale: LocaleEstimate[] = [];
  for (const [locale, group] of byLocale) {
    let inputTokens = 0;
    let outputTokens = 0;
    const batches = chunk(group, Math.max(1, ai.batchSize));
    for (const batch of batches) {
      const system = buildSystemPrompt(batch.some((r) => r.plural !== undefined));
      inputTokens += estimateTokens(system) + estimateTokens(buildBatchPrompt(batch));
      for (const r of batch) outputTokens += estimateOutputTokens(r);
    }
    perLocale.push({ locale, requests: group.length, batches: batches.length, inputTokens, outputTokens });
  }
  const inputTokens = perLocale.reduce((n, l) => n + l.inputTokens, 0);
  const outputTokens = perLocale.reduce((n, l) => n + l.outputTokens, 0);
  const pricing = resolvePricing(ai);
  return {
    requests: reqs.length,
    batches: perLocale.reduce((n, l) => n + l.batches, 0),
    perLocale,
    inputTokens,
    outputTokens,
    pricing,
    estimatedCost: pricing ? (inputTokens * pricing.inputPerMTok + outputTokens * pricing.outputPerMTok) / 1e6 : null,
  };
}
