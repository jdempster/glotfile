import { describe, it, expect, test } from "vitest";
import { estimateTokens, estimateTranslation, estimateContext, estimateGlossarySuggest } from "./estimate.js";
import { buildSystemPrompt, buildBatchPrompt } from "./provider.js";
import { buildContextSystemPrompt, buildContextBatchPrompt, type ContextRequest } from "./context.js";
import { selectRequests } from "./run.js";
import { defaultState, type AiConfig } from "../schema.js";
import { createKey, convertToPlural } from "../state.js";

const ai: AiConfig = { provider: "anthropic", model: "claude-haiku-4-5-20251001", endpoint: null, batchSize: 2 };

function makeState() {
  const s = defaultState();
  s.config.locales = ["en", "fr", "de"];
  createKey(s, "a.one", "Sign in to {site}");
  createKey(s, "a.two", "Forgot password?");
  createKey(s, "a.three", "Welcome back");
  return s;
}

describe("estimateTokens", () => {
  it("approximates Latin text at chars/4 and CJK denser", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    // 4 CJK chars ≈ 2 tokens, not 1
    expect(estimateTokens("日本語例")).toBe(2);
  });
});

describe("estimateTranslation", () => {
  it("counts requests, batches per locale, and prices the run", () => {
    const est = estimateTranslation(makeState(), ai, { onlyMissing: true });
    // 3 keys × 2 target locales
    expect(est.requests).toBe(6);
    // batchSize 2 → 2 batches per locale (3 requests each), 2 locales
    expect(est.batches).toBe(4);
    expect(est.perLocale.map((l) => l.locale).sort()).toEqual(["de", "fr"]);
    expect(est.perLocale[0]!.batches).toBe(2);
    expect(est.inputTokens).toBeGreaterThan(0);
    expect(est.outputTokens).toBeGreaterThan(0);
    expect(est.pricing).toEqual({ source: "builtin", inputPerMTok: 1, outputPerMTok: 5 });
    expect(est.estimatedCost).toBeCloseTo((est.inputTokens * 1 + est.outputTokens * 5) / 1e6, 10);
  });

  it("input tokens come from the real rendered prompts", () => {
    const s = makeState();
    const one = { ...ai, batchSize: 100 };
    const est = estimateTranslation(s, one, { onlyMissing: true, locales: ["fr"] });
    const reqs = selectRequests(s, { onlyMissing: true, locales: ["fr"] });
    const expected = estimateTokens(buildSystemPrompt(false)) + estimateTokens(buildBatchPrompt(reqs));
    expect(est.batches).toBe(1);
    expect(est.inputTokens).toBe(expected);
  });

  it("plural items scale output by required categories", () => {
    const s = makeState();
    convertToPlural(s, "a.one", "count");
    const scalar = estimateTranslation(makeState(), ai, { onlyMissing: true, locales: ["fr"], keys: ["a.one"] });
    const plural = estimateTranslation(s, ai, { onlyMissing: true, locales: ["fr"], keys: ["a.one"] });
    expect(plural.outputTokens).toBeGreaterThan(scalar.outputTokens);
  });

  it("empty selection → zeros with $0 cost", () => {
    const est = estimateTranslation(defaultState(), ai, { onlyMissing: true });
    expect(est).toMatchObject({ requests: 0, batches: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 });
  });

  it("unknown model → cost null, tokens still present", () => {
    const est = estimateTranslation(makeState(), { ...ai, provider: "openai", model: "mystery-model" }, { onlyMissing: true });
    expect(est.pricing).toBeNull();
    expect(est.estimatedCost).toBeNull();
    expect(est.inputTokens).toBeGreaterThan(0);
  });
});

function makeContextTargets(): ContextRequest[] {
  return [
    { id: "0", key: "a.one", source: "Sign in to {site}", usageSnippets: [] },
    { id: "1", key: "a.two", source: "Forgot password?", usageSnippets: [] },
    { id: "2", key: "a.three", source: "Welcome back", usageSnippets: [] },
  ];
}

describe("estimateContext", () => {
  it("counts keys, batches, and prices the run", () => {
    const est = estimateContext(makeContextTargets(), ai);
    expect(est.keys).toBe(3);
    // batchSize 2 → 2 batches (2 + 1)
    expect(est.batches).toBe(2);
    expect(est.inputTokens).toBeGreaterThan(0);
    expect(est.outputTokens).toBeGreaterThan(0);
    expect(est.pricing).toEqual({ source: "builtin", inputPerMTok: 1, outputPerMTok: 5 });
    expect(est.estimatedCost).toBeCloseTo((est.inputTokens * 1 + est.outputTokens * 5) / 1e6, 10);
  });

  it("input tokens come from the real rendered prompts", () => {
    const targets = makeContextTargets();
    const est = estimateContext(targets, { ...ai, batchSize: 100 });
    const expected = estimateTokens(buildContextSystemPrompt()) + estimateTokens(buildContextBatchPrompt(targets));
    expect(est.batches).toBe(1);
    expect(est.inputTokens).toBe(expected);
  });

  it("contextBatchSize overrides batchSize", () => {
    const est = estimateContext(makeContextTargets(), { ...ai, batchSize: 100, contextBatchSize: 1 });
    expect(est.batches).toBe(3);
  });

  it("empty selection → zeros with $0 cost", () => {
    const est = estimateContext([], ai);
    expect(est).toMatchObject({ keys: 0, batches: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 });
  });

  it("unknown model → cost null, tokens still present", () => {
    const est = estimateContext(makeContextTargets(), { ...ai, provider: "openai", model: "mystery-model" });
    expect(est.pricing).toBeNull();
    expect(est.estimatedCost).toBeNull();
    expect(est.inputTokens).toBeGreaterThan(0);
  });
});

test("estimateGlossarySuggest returns batches, tokens, and (with pricing) a cost", () => {
  const sources = Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, source: "Sign in to Acme dashboard" }));
  const ai = { provider: "anthropic", model: "claude-x", batchSize: 10, inputPricePerMTok: 3, outputPricePerMTok: 15 } as any;
  const est = estimateGlossarySuggest(sources, [], ai);
  expect(est.sources).toBe(25);
  expect(est.batches).toBe(3);
  expect(est.inputTokens).toBeGreaterThan(0);
  expect(est.estimatedCost).toBeGreaterThan(0);
});
