import type { AiConfig } from "../schema.js";

export interface ResolvedPricing {
  source: "builtin" | "profile";
  inputPerMTok: number;
  outputPerMTok: number;
}

// Real token usage reported by a provider, summed across one run's API calls.
// Cache fields are zero for providers without prompt caching.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export function addUsage(into: TokenUsage, add: TokenUsage): void {
  into.inputTokens += add.inputTokens;
  into.outputTokens += add.outputTokens;
  into.cacheCreationInputTokens += add.cacheCreationInputTokens;
  into.cacheReadInputTokens += add.cacheReadInputTokens;
}

// The Message Batches API bills at half the synchronous price.
export const BATCH_PRICE_MULTIPLIER = 0.5;

// Anthropic cache economics: writes cost 1.25x base input, reads 0.1x.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

// Convenience for log entries: cost of drained usage under the config's
// pricing, or undefined when there's no usage or no price data.
export function usageCostUsd(usage: TokenUsage | undefined, ai: AiConfig, multiplier = 1): number | undefined {
  if (!usage) return undefined;
  const pricing = resolvePricing(ai);
  return pricing ? estimateUsageCostUsd(usage, pricing, multiplier) : undefined;
}

// Dollar cost of real usage. `multiplier` scales the whole figure — pass
// BATCH_PRICE_MULTIPLIER for usage billed through the batch API.
export function estimateUsageCostUsd(usage: TokenUsage, pricing: ResolvedPricing, multiplier = 1): number {
  const inputCost =
    (usage.inputTokens +
      usage.cacheCreationInputTokens * CACHE_WRITE_MULTIPLIER +
      usage.cacheReadInputTokens * CACHE_READ_MULTIPLIER) * pricing.inputPerMTok;
  return ((inputCost + usage.outputTokens * pricing.outputPerMTok) / 1e6) * multiplier;
}

// $ per 1M tokens, keyed by model-ID prefix; longest match wins. Verified
// against the Anthropic and OpenAI pricing pages 2026-06-10; profile prices
// override anything stale or missing here.
const PRICE_TABLE: Array<[prefix: string, input: number, output: number]> = [
  ["claude-fable-5", 10, 50],
  ["claude-mythos-5", 10, 50],
  // Deprecated Opus 4.1 / 4.0 cost 3x the 4.5+ generation — they must outrank
  // the shorter "claude-opus-4" prefix (4-2025 covers the dated Opus 4 full IDs).
  ["claude-opus-4-1", 15, 75],
  ["claude-opus-4-0", 15, 75],
  ["claude-opus-4-2025", 15, 75],
  ["claude-opus-4", 5, 25],
  ["claude-sonnet-4", 3, 15],
  ["claude-haiku-4", 1, 5],
  ["claude-3-5-haiku", 0.8, 4],
  ["gpt-5.5-pro", 30, 180],
  ["gpt-5.5", 5, 30],
  ["gpt-5.4-pro", 30, 180],
  ["gpt-5.4-mini", 0.75, 4.5],
  ["gpt-5.4-nano", 0.2, 1.25],
  ["gpt-5.4", 2.5, 15],
  ["gpt-5.3-codex", 1.75, 14],
];

// Local or subscription-billed providers: no per-token cost.
const FREE_PROVIDERS = new Set<AiConfig["provider"]>(["ollama", "claude-code"]);

// Bedrock IDs ("eu.anthropic.claude-…") and OpenRouter IDs ("anthropic/claude-…")
// wrap the bare model ID; strip the vendor wrapping before prefix-matching.
function bareModelId(model: string): string {
  let id = model.trim().toLowerCase();
  const slash = id.lastIndexOf("/");
  if (slash !== -1) id = id.slice(slash + 1);
  const anth = id.lastIndexOf("anthropic.");
  if (anth !== -1) id = id.slice(anth + "anthropic.".length);
  return id;
}

// Hybrid resolution: an explicit per-profile price (both fields set) wins, then
// the built-in table, then $0 providers; null means "no dollar figure possible".
export function resolvePricing(ai: AiConfig): ResolvedPricing | null {
  if (ai.inputPricePerMTok !== undefined && ai.outputPricePerMTok !== undefined) {
    return { source: "profile", inputPerMTok: ai.inputPricePerMTok, outputPerMTok: ai.outputPricePerMTok };
  }
  if (FREE_PROVIDERS.has(ai.provider)) return { source: "builtin", inputPerMTok: 0, outputPerMTok: 0 };
  const id = bareModelId(ai.model);
  let best: [string, number, number] | undefined;
  for (const row of PRICE_TABLE) {
    if (id.startsWith(row[0]) && (!best || row[0].length > best[0].length)) best = row;
  }
  return best ? { source: "builtin", inputPerMTok: best[1], outputPerMTok: best[2] } : null;
}
