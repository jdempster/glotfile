import { describe, it, expect, vi } from "vitest";
import { OllamaProvider, ollamaClientOptions } from "./ollama.js";
import { makeProvider } from "./index.js";
import type { AiConfig } from "../schema.js";
import type { TranslationRequest } from "./provider.js";
import type { ReplyItem } from "./batch.js";

const config: AiConfig = { provider: "ollama", model: "llama3.2", endpoint: null, batchSize: 25 };

function withKey<T>(key: string | undefined, fn: () => T): T {
  const prev = process.env.OLLAMA_API_KEY;
  if (key === undefined) delete process.env.OLLAMA_API_KEY;
  else process.env.OLLAMA_API_KEY = key;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = prev;
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

describe("ollamaClientOptions", () => {
  it("defaults the base URL to the local Ollama server and uses a placeholder key", () => {
    const opts = withKey(undefined, () => ollamaClientOptions(config));
    expect(opts.baseURL).toBe("http://localhost:11434/v1");
    expect(opts.apiKey).toBe("ollama");
  });

  it("honors OLLAMA_API_KEY when set, for secured/remote deployments", () => {
    const opts = withKey("secret-token", () => ollamaClientOptions(config));
    expect(opts.apiKey).toBe("secret-token");
  });

  it("honors an explicit endpoint override", () => {
    const opts = withKey(undefined, () => ollamaClientOptions({ ...config, endpoint: "http://ollama.example:11434/v1" }));
    expect(opts.baseURL).toBe("http://ollama.example:11434/v1");
  });
});

describe("OllamaProvider", () => {
  it("translates via the inherited OpenAI-compatible logic", async () => {
    const p = new OllamaProvider(config, fakeClient([{ id: "0", translation: "Salut {name}" }]) as never);
    const [res] = await p.translate([baseReq]);
    expect(res).toEqual({ id: "0", translation: "Salut {name}" });
  });

  it("reports supportsVision false (most local models are text-only)", () => {
    expect(new OllamaProvider(config, fakeClient([]) as never).supportsVision()).toBe(false);
  });

  it("constructs without an API key set (local Ollama needs no auth)", () => {
    withKey(undefined, () => {
      expect(() => makeProvider(config)).not.toThrow();
    });
  });
});

describe("makeProvider", () => {
  it("returns an OllamaProvider for provider \"ollama\"", () => {
    expect(makeProvider(config)).toBeInstanceOf(OllamaProvider);
  });
});

describe("OllamaProvider with translategemma strategy", () => {
  const tgConfig: AiConfig = {
    provider: "ollama", model: "translategemma:4b", endpoint: null,
    batchSize: 1, promptStyle: "translategemma",
  };

  function fakeClientPlainText(text: string) {
    return {
      chat: { completions: { create: vi.fn(async () => ({
        choices: [{ message: { content: text } }],
      })) } },
    };
  }

  it("translates a single item using plain-text strategy", async () => {
    const client = fakeClientPlainText("Salut {name}");
    const p = new OllamaProvider(tgConfig, client as never);
    const req: TranslationRequest = {
      id: "0", key: "k", source: "Hi {name}", sourceLocale: "en",
      targetLocale: "fr", placeholders: ["name"],
    };
    const [res] = await p.translate([req]);
    expect(res?.translation).toBe("Salut {name}");
  });

  it("uses a system message that includes source and target locale", async () => {
    const client = fakeClientPlainText("Salut");
    const p = new OllamaProvider(tgConfig, client as never);
    const req: TranslationRequest = {
      id: "0", key: "k", source: "Hi", sourceLocale: "en",
      targetLocale: "fr", placeholders: [],
    };
    await p.translate([req]);
    const callArgs = (client.chat.completions.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    const systemMsg = callArgs.messages.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("en");
    expect(systemMsg?.content).toContain("fr");
  });

  it("does not pass response_format to the API for translategemma", async () => {
    const client = fakeClientPlainText("Salut");
    const p = new OllamaProvider(tgConfig, client as never);
    const req: TranslationRequest = {
      id: "0", key: "k", source: "Hi", sourceLocale: "en",
      targetLocale: "fr", placeholders: [],
    };
    await p.translate([req]);
    const callArgs = (client.chat.completions.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.response_format).toBeUndefined();
  });
});
