import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolvePricing, estimateUsageCostUsd, type ResolvedPricing, type TokenUsage } from "./pricing.js";
import { setPriceCache } from "./price-cache.js";
import type { AiConfig } from "../schema.js";

const base: AiConfig = { provider: "anthropic", model: "claude-haiku-4-5-20251001", endpoint: null, batchSize: 25 };

// Isolate from any real ~/.glotfile/model-prices.json on the dev machine.
beforeEach(() => setPriceCache(null));

describe("resolvePricing", () => {
  it("matches Claude models by prefix (dated IDs included)", () => {
    expect(resolvePricing(base)).toEqual({ source: "builtin", inputPerMTok: 1, outputPerMTok: 5 });
    expect(resolvePricing({ ...base, model: "claude-sonnet-4-6" })).toEqual({ source: "builtin", inputPerMTok: 3, outputPerMTok: 15 });
    expect(resolvePricing({ ...base, model: "claude-opus-4-8" })?.inputPerMTok).toBe(5);
  });

  it("prices deprecated Opus 4.1/4.0 at their higher legacy rate", () => {
    expect(resolvePricing({ ...base, model: "claude-opus-4-1" })).toEqual({ source: "builtin", inputPerMTok: 15, outputPerMTok: 75 });
    expect(resolvePricing({ ...base, model: "claude-opus-4-20250514" })?.outputPerMTok).toBe(75);
    expect(resolvePricing({ ...base, model: "claude-opus-4-8" })?.outputPerMTok).toBe(25);
  });

  it("prices the GPT family", () => {
    expect(resolvePricing({ ...base, provider: "openai", model: "gpt-5.4" })).toEqual({ source: "builtin", inputPerMTok: 2.5, outputPerMTok: 15 });
    expect(resolvePricing({ ...base, provider: "openai", model: "gpt-5.4-mini" })?.inputPerMTok).toBe(0.75);
    expect(resolvePricing({ ...base, provider: "openai", model: "gpt-5.5-pro" })?.outputPerMTok).toBe(180);
  });

  it("strips Bedrock and OpenRouter ID prefixes before matching", () => {
    expect(resolvePricing({ ...base, provider: "bedrock", model: "eu.anthropic.claude-sonnet-4-6" })?.inputPerMTok).toBe(3);
    expect(resolvePricing({ ...base, provider: "openrouter", model: "anthropic/claude-haiku-4-5" })?.inputPerMTok).toBe(1);
  });

  it("profile $/MTok override beats the builtin table", () => {
    expect(resolvePricing({ ...base, inputPricePerMTok: 0.4, outputPricePerMTok: 2 }))
      .toEqual({ source: "profile", inputPerMTok: 0.4, outputPerMTok: 2 });
  });

  it("a half-set override is ignored (falls through to builtin)", () => {
    expect(resolvePricing({ ...base, inputPricePerMTok: 0.4 })?.source).toBe("builtin");
  });

  it("ollama and claude-code are $0", () => {
    expect(resolvePricing({ ...base, provider: "ollama", model: "qwen3:14b" }))
      .toEqual({ source: "builtin", inputPerMTok: 0, outputPerMTok: 0 });
    expect(resolvePricing({ ...base, provider: "claude-code", model: "sonnet" })?.outputPerMTok).toBe(0);
  });

  it("unknown model with no override → null", () => {
    expect(resolvePricing({ ...base, provider: "openai", model: "mystery-model" })).toBeNull();
  });
});

describe("resolvePricing with a cache present", () => {
  beforeEach(() => setPriceCache({
    source: "models.dev",
    fetchedAt: "2026-06-16T00:00:00.000Z",
    models: {
      "claude-opus-4-8": { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.4, cacheWritePerMTok: 5 },
      "gpt-5.9": { inputPerMTok: 9, outputPerMTok: 40 },
    },
  }));
  afterEach(() => setPriceCache(null));

  it("cache beats the builtin table and carries cache rates", () => {
    expect(resolvePricing({ ...base, model: "claude-opus-4-8" })).toEqual({
      source: "cache", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.4, cacheWritePerMTok: 5,
    });
  });

  it("profile override still beats the cache", () => {
    expect(resolvePricing({ ...base, model: "claude-opus-4-8", inputPricePerMTok: 1, outputPricePerMTok: 2 })?.source).toBe("profile");
  });

  it("falls back to builtin when the cache lacks the model", () => {
    expect(resolvePricing({ ...base, model: "claude-sonnet-4-6" })?.source).toBe("builtin");
  });

  it("covers long-tail models only the cache knows", () => {
    expect(resolvePricing({ ...base, provider: "openai", model: "gpt-5.9" })).toMatchObject({ source: "cache", inputPerMTok: 9 });
  });

  it("free providers stay $0 even with a cache present", () => {
    expect(resolvePricing({ ...base, provider: "ollama", model: "qwen3:14b" })?.outputPerMTok).toBe(0);
  });

  it("strips bedrock/openrouter prefixes before the cache match", () => {
    expect(resolvePricing({ ...base, provider: "bedrock", model: "eu.anthropic.claude-opus-4-8" })).toMatchObject({ source: "cache", inputPerMTok: 4 });
  });
});

describe("estimateUsageCostUsd cache economics", () => {
  const usage: TokenUsage = {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationInputTokens: 1_000_000,
    cacheReadInputTokens: 1_000_000,
  };

  it("uses explicit per-model cache rates when present", () => {
    const pricing: ResolvedPricing = { source: "cache", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 1, cacheWritePerMTok: 8 };
    // input 4 + write 8 + read 1 + output 20
    expect(estimateUsageCostUsd(usage, pricing)).toBeCloseTo(33, 5);
  });

  it("falls back to 1.25x/0.1x multipliers when cache rates absent", () => {
    const pricing: ResolvedPricing = { source: "builtin", inputPerMTok: 4, outputPerMTok: 20 };
    // input 4 + write 4*1.25 + read 4*0.1 + output 20 = 29.4
    expect(estimateUsageCostUsd(usage, pricing)).toBeCloseTo(29.4, 5);
  });
});
