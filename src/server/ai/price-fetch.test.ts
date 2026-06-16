import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { normalizeModelsDevPrices, refreshPrices } from "./price-fetch.js";

// A trimmed slice of models.dev's api.json shape: keyed by provider id, each
// provider has a `models` object keyed by the prefixed model id, each model
// carries a `cost` block in $ per 1M tokens.
const SAMPLE = {
  anthropic: {
    id: "anthropic",
    models: {
      "anthropic/claude-opus-4-8": {
        id: "anthropic/claude-opus-4-8",
        cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
      },
      "anthropic/claude-haiku-4-5": {
        id: "anthropic/claude-haiku-4-5",
        cost: { input: 1, output: 5 },
      },
    },
  },
  openai: {
    id: "openai",
    models: {
      "openai/gpt-5.4": { id: "openai/gpt-5.4", cost: { input: 2.5, output: 15 } },
    },
  },
  // A reseller that re-lists Claude at a marked-up price; first-party anthropic
  // should win for the same bare id.
  openrouter: {
    id: "openrouter",
    models: {
      "openrouter/claude-opus-4-8": {
        id: "openrouter/claude-opus-4-8",
        cost: { input: 6, output: 30 },
      },
      "openrouter/some-oss-model": {
        id: "openrouter/some-oss-model",
        cost: { input: 0.2, output: 0.4 },
      },
    },
  },
};

describe("normalizeModelsDevPrices", () => {
  it("flattens to bare-id keys with per-MTok costs incl. cache rates", () => {
    const models = normalizeModelsDevPrices(SAMPLE);
    expect(models["claude-opus-4-8"]).toEqual({
      inputPerMTok: 5,
      outputPerMTok: 25,
      cacheReadPerMTok: 0.5,
      cacheWritePerMTok: 6.25,
    });
    expect(models["gpt-5.4"]).toEqual({ inputPerMTok: 2.5, outputPerMTok: 15 });
  });

  it("omits cache rates when the source doesn't report them", () => {
    const models = normalizeModelsDevPrices(SAMPLE);
    expect(models["claude-haiku-4-5"]).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
    expect(models["claude-haiku-4-5"]).not.toHaveProperty("cacheReadPerMTok");
  });

  it("prefers the first-party provider's price over a reseller's", () => {
    const models = normalizeModelsDevPrices(SAMPLE);
    expect(models["claude-opus-4-8"]?.inputPerMTok).toBe(5);
  });

  it("still includes long-tail models only a reseller lists", () => {
    const models = normalizeModelsDevPrices(SAMPLE);
    expect(models["some-oss-model"]).toEqual({ inputPerMTok: 0.2, outputPerMTok: 0.4 });
  });

  it("skips entries without numeric input/output and malformed input", () => {
    expect(normalizeModelsDevPrices(null)).toEqual({});
    expect(normalizeModelsDevPrices({ p: { models: { "p/x": { cost: { input: 1 } } } } })).toEqual({});
    expect(normalizeModelsDevPrices({ p: { models: { "p/x": {} } } })).toEqual({});
  });
});

describe("refreshPrices", () => {
  const path = join(tmpdir(), `glotfile-prices-test-${process.pid}.json`);

  function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
    return (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
  }

  it("fetches, normalizes, and writes the cache file", async () => {
    const res = await refreshPrices({
      path,
      url: "https://example.test/api.json",
      fetchImpl: fakeFetch(SAMPLE),
      now: () => "2026-06-16T00:00:00.000Z",
    });
    expect(res.modelCount).toBe(4);
    expect(res.source).toBe("models.dev");
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.fetchedAt).toBe("2026-06-16T00:00:00.000Z");
    expect(written.models["claude-opus-4-8"].inputPerMTok).toBe(5);
    rmSync(path, { force: true });
  });

  it("throws on a non-OK response and does not write", async () => {
    const missing = join(tmpdir(), `glotfile-prices-miss-${process.pid}.json`);
    rmSync(missing, { force: true });
    await expect(
      refreshPrices({ path: missing, fetchImpl: fakeFetch({}, false, 503) }),
    ).rejects.toThrow(/503/);
    expect(() => readFileSync(missing, "utf8")).toThrow();
  });

  it("throws when the response carries no usable prices", async () => {
    await expect(
      refreshPrices({ path, fetchImpl: fakeFetch({ anthropic: { models: {} } }) }),
    ).rejects.toThrow(/no model prices/i);
  });
});
