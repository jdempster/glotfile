import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
import { loadPriceCache, savePriceCache, getPriceCache, setPriceCache, invalidatePriceCache, type PriceCache } from "./price-cache.js";

const cache: PriceCache = {
  source: "models.dev",
  fetchedAt: "2026-06-16T00:00:00.000Z",
  models: { "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 } },
};

describe("price cache IO", () => {
  const path = join(tmpdir(), `glotfile-cache-io-${process.pid}.json`);
  afterEach(() => rmSync(path, { force: true }));

  it("round-trips save → load", () => {
    savePriceCache(cache, path);
    expect(loadPriceCache(path)).toEqual(cache);
  });

  it("returns null for a missing file", () => {
    expect(loadPriceCache(join(tmpdir(), "glotfile-does-not-exist.json"))).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    writeFileSync(path, "{ not json");
    expect(loadPriceCache(path)).toBeNull();
  });

  it("drops malformed model entries but keeps valid ones", () => {
    writeFileSync(path, JSON.stringify({
      source: "models.dev",
      fetchedAt: "x",
      models: { good: { inputPerMTok: 1, outputPerMTok: 2 }, bad: { inputPerMTok: "nope" } },
    }));
    expect(loadPriceCache(path)?.models).toEqual({ good: { inputPerMTok: 1, outputPerMTok: 2 } });
  });
});

describe("price cache memo", () => {
  afterEach(() => invalidatePriceCache());

  it("setPriceCache overrides what getPriceCache returns", () => {
    setPriceCache(cache);
    expect(getPriceCache()).toEqual(cache);
    setPriceCache(null);
    expect(getPriceCache()).toBeNull();
  });
});
