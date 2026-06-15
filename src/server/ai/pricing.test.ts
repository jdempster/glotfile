import { describe, it, expect } from "vitest";
import { resolvePricing } from "./pricing.js";
import type { AiConfig } from "../schema.js";

const base: AiConfig = { provider: "anthropic", model: "claude-haiku-4-5-20251001", endpoint: null, batchSize: 25 };

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
