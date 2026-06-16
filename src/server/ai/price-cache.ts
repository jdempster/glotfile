import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic-write.js";

// Per-model prices in $ per 1M tokens. cacheRead/cacheWrite are absent when the
// source doesn't report them; the cost math falls back to its multiplier
// heuristics in that case.
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

// The on-disk pricing cache: a snapshot of a community price source, keyed by
// bare model id (provider prefix stripped), one canonical price per id.
export interface PriceCache {
  source: string;
  fetchedAt: string;
  models: Record<string, ModelPrice>;
}

// Machine-global, alongside ui.json — pricing isn't project-specific, so the
// cache is shared across every glotfile checkout on this machine.
// GLOTFILE_PRICES_PATH relocates it (tests / power users).
export const defaultPriceCachePath = (): string =>
  process.env.GLOTFILE_PRICES_PATH || join(homedir(), ".glotfile", "model-prices.json");

function isModelPrice(v: unknown): v is ModelPrice {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.inputPerMTok === "number" && typeof p.outputPerMTok === "number";
}

// Read + parse + shallow-validate; null on a missing or corrupt file so callers
// transparently fall back to the bundled price table.
export function loadPriceCache(path = defaultPriceCachePath()): PriceCache | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed as Record<string, unknown>;
  if (!raw.models || typeof raw.models !== "object") return null;
  const models: Record<string, ModelPrice> = {};
  for (const [id, price] of Object.entries(raw.models as Record<string, unknown>)) {
    if (isModelPrice(price)) models[id] = price;
  }
  return {
    source: typeof raw.source === "string" ? raw.source : "unknown",
    fetchedAt: typeof raw.fetchedAt === "string" ? raw.fetchedAt : "",
    models,
  };
}

export function savePriceCache(cache: PriceCache, path = defaultPriceCachePath()): void {
  writeFileAtomic(path, JSON.stringify(cache, null, 2) + "\n");
}

// Process-memoized accessor used by resolvePricing. The memo lets a long-running
// server reuse one read, and invalidate/set keep it correct after a refresh (or
// deterministic in tests). `undefined` means "not yet loaded"; `null` means
// "loaded, no cache present".
let memo: PriceCache | null | undefined;

export function getPriceCache(): PriceCache | null {
  if (memo === undefined) memo = loadPriceCache();
  return memo;
}

export function setPriceCache(cache: PriceCache | null): void {
  memo = cache;
}

export function invalidatePriceCache(): void {
  memo = undefined;
}
