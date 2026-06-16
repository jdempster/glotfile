import { bareModelId } from "./pricing.js";
import { savePriceCache, defaultPriceCachePath, type ModelPrice, type PriceCache } from "./price-cache.js";

export const MODELS_DEV_URL = "https://models.dev/api.json";

// Override the source URL (self-hosted mirror / tests) without touching config.
const priceUrl = (): string => process.env.GLOTFILE_PRICES_URL || MODELS_DEV_URL;

// First-party providers price the model; resellers (bedrock/openrouter/azure)
// re-list it, sometimes with markup. Prefer the first-party price so the cache
// mirrors the canonical figures the bundled table holds — lower index wins.
const PROVIDER_PREFERENCE = ["anthropic", "openai", "google", "meta-llama", "mistral", "deepseek", "xai", "groq"];

const providerRank = (provId: string): number => {
  const i = PROVIDER_PREFERENCE.indexOf(provId);
  return i === -1 ? PROVIDER_PREFERENCE.length : i;
};

interface ModelsDevModel {
  cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown };
}

// models.dev api.json shape: root[providerId].models[prefixedModelId].cost, all
// costs already in $ per 1M tokens. Flatten to one canonical price per bare id.
export function normalizeModelsDevPrices(api: unknown): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  const ranks: Record<string, number> = {};
  if (!api || typeof api !== "object") return out;
  for (const [provId, prov] of Object.entries(api as Record<string, { models?: unknown }>)) {
    const models = prov?.models;
    if (!models || typeof models !== "object") continue;
    const rank = providerRank(provId);
    for (const [modelKey, model] of Object.entries(models as Record<string, ModelsDevModel>)) {
      const cost = model?.cost;
      if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") continue;
      const bareId = bareModelId(modelKey);
      if (!bareId) continue;
      // A first-party listing already won this id — keep it over a reseller's.
      const existingRank = ranks[bareId];
      if (existingRank !== undefined && existingRank <= rank) continue;
      const price: ModelPrice = { inputPerMTok: cost.input, outputPerMTok: cost.output };
      if (typeof cost.cache_read === "number") price.cacheReadPerMTok = cost.cache_read;
      if (typeof cost.cache_write === "number") price.cacheWritePerMTok = cost.cache_write;
      out[bareId] = price;
      ranks[bareId] = rank;
    }
  }
  return out;
}

export interface RefreshResult {
  source: string;
  fetchedAt: string;
  modelCount: number;
  path: string;
}

const defaultNow = (): string => new Date().toISOString();

// Fetch the source, normalize, and atomically write the cache. fetch/now/path
// are injectable for tests. On any failure (offline, HTTP error, empty payload)
// it throws and never writes — leaving an existing cache untouched.
export async function refreshPrices(opts: {
  path?: string;
  url?: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
} = {}): Promise<RefreshResult> {
  const url = opts.url ?? priceUrl();
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch prices from ${url}: HTTP ${res.status}`);
  const api = await res.json();
  const models = normalizeModelsDevPrices(api);
  const modelCount = Object.keys(models).length;
  if (modelCount === 0) throw new Error(`No model prices found in response from ${url}`);
  const cache: PriceCache = { source: "models.dev", fetchedAt: (opts.now ?? defaultNow)(), models };
  const path = opts.path ?? defaultPriceCachePath();
  savePriceCache(cache, path);
  return { source: cache.source, fetchedAt: cache.fetchedAt, modelCount, path };
}
