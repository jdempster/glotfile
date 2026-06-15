import { describe, it, expect, vi } from "vitest";
import { OpenRouterProvider, openRouterClientOptions } from "./openrouter.js";
import type { AiConfig } from "../schema.js";
import type { TranslationRequest } from "./provider.js";
import type { ReplyItem } from "./batch.js";

const config: AiConfig = { provider: "openrouter", model: "anthropic/claude-3.5-haiku", endpoint: null, batchSize: 25 };

function withKey<T>(key: string | undefined, fn: () => T): T {
  const prev = process.env.OPENROUTER_API_KEY;
  if (key === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = key;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prev;
  }
}

function fakeClient(items: ReplyItem[]) {
  return {
    chat: { completions: { create: vi.fn(async () => ({
      choices: [{ message: { content: JSON.stringify({ items }) } }],
    })) } },
  };
}

const baseReq: TranslationRequest = { id: "0", key: "k", source: "Hi {name}", sourceLocale: "en", targetLocale: "fr", placeholders: ["name"] };

describe("openRouterClientOptions", () => {
  it("defaults the base URL to the OpenRouter API and sets attribution headers", () => {
    const opts = withKey("sk-or-test", () => openRouterClientOptions(config));
    expect(opts.apiKey).toBe("sk-or-test");
    expect(opts.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(opts.defaultHeaders["X-Title"]).toBe("glotfile");
    expect(opts.defaultHeaders["HTTP-Referer"]).toMatch(/glotfile/);
  });

  it("honors an explicit endpoint override", () => {
    const opts = withKey("sk-or-test", () => openRouterClientOptions({ ...config, endpoint: "https://gateway.example/v1" }));
    expect(opts.baseURL).toBe("https://gateway.example/v1");
  });

  it("throws a clear error when OPENROUTER_API_KEY is missing", () => {
    withKey(undefined, () => {
      expect(() => openRouterClientOptions(config)).toThrow(/OPENROUTER_API_KEY/);
    });
  });
});

describe("OpenRouterProvider", () => {
  it("translates via the inherited OpenAI-compatible logic", async () => {
    const p = new OpenRouterProvider(config, fakeClient([{ id: "0", translation: "Salut {name}" }]) as never);
    const [res] = await p.translate([baseReq]);
    expect(res).toEqual({ id: "0", translation: "Salut {name}" });
  });

  it("reports supportsVision true", () => {
    expect(new OpenRouterProvider(config, fakeClient([]) as never).supportsVision()).toBe(true);
  });

  it("throws when OPENROUTER_API_KEY is missing and no client injected", () => {
    withKey(undefined, () => {
      expect(() => new OpenRouterProvider(config)).toThrow(/OPENROUTER_API_KEY/);
    });
  });
});
