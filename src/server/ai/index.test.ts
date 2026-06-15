import { describe, it, expect } from "vitest";
import { makeProvider } from "./index.js";
import { defaultLocalSettings } from "../local-settings.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { BedrockProvider } from "./bedrock.js";
import { OpenRouterProvider } from "./openrouter.js";

describe("makeProvider", () => {
  const base = defaultLocalSettings().ai;

  it("selects the implementation named by ai.provider", () => {
    const prev = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY, r: process.env.OPENROUTER_API_KEY };
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENROUTER_API_KEY = "test";
    try {
      expect(makeProvider({ ...base, provider: "anthropic" })).toBeInstanceOf(AnthropicProvider);
      expect(makeProvider({ ...base, provider: "openai" })).toBeInstanceOf(OpenAIProvider);
      expect(makeProvider({ ...base, provider: "bedrock", region: "us-east-1" })).toBeInstanceOf(BedrockProvider);
      expect(makeProvider({ ...base, provider: "openrouter" })).toBeInstanceOf(OpenRouterProvider);
    } finally {
      if (prev.a === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.a;
      if (prev.o === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev.o;
      if (prev.r === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prev.r;
    }
  });

  it("throws a clear error on an unknown provider", () => {
    expect(() => makeProvider({ ...base, provider: "bogus" as never }))
      .toThrow(/Unknown AI provider/);
  });
});
