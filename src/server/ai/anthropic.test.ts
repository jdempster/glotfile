import { describe, it, expect, vi } from "vitest";
import { AnthropicProvider } from "./anthropic.js";
import type { TranslationRequest, BatchJobSpec } from "./provider.js";

const config = { provider: "anthropic" as const, model: "claude-opus-4-8", endpoint: null, batchSize: 25 };

function fakeClient(reply: Record<string, string>) {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: "text", text: JSON.stringify({ items: Object.entries(reply).map(([id, translation]) => ({ id, translation })) }) }],
      })),
    },
  };
}

function fakeFormsClient(reply: Record<string, Record<string, string>>) {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: "text", text: JSON.stringify({ items: Object.entries(reply).map(([id, forms]) => ({ id, forms })) }) }],
      })),
    },
  };
}

const baseReq: TranslationRequest = {
  id: "0", key: "k", source: "Hi {name}", sourceLocale: "en", targetLocale: "fr", placeholders: ["name"],
};

const pluralReq: TranslationRequest = {
  id: "0", key: "cart.items", source: "{count} items", sourceLocale: "en", targetLocale: "pl", placeholders: ["count"],
  plural: { arg: "count", categories: ["one", "few", "many", "other"], sourceForms: { one: "{count} item", other: "{count} items" } },
};

describe("AnthropicProvider", () => {
  it("returns translations parsed from structured output", async () => {
    const client = fakeClient({ "0": "Salut {name}" });
    const p = new AnthropicProvider(config, client as never);
    const [res] = await p.translate([baseReq]);
    expect(res).toEqual({ id: "0", translation: "Salut {name}" });
  });

  it("treats a max_tokens-truncated reply as malformed instead of silently accepting it", async () => {
    // The reply parses, but stop_reason says it was cut off — tail items would be
    // silently lost. It must bisect/retry, then degrade the lone item to an error.
    const client = {
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: "text", text: JSON.stringify({ items: [{ id: "0", translation: "Salut {name}" }] }) }],
          stop_reason: "max_tokens",
        })),
      },
    };
    const p = new AnthropicProvider(config, client as never);
    const [res] = await p.translate([baseReq]);
    expect(res!.translation).toBeUndefined();
    expect(res!.error).toMatch(/malformed/i);
    // original call + one retry of the single-item batch
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("returns plural forms parsed from structured output", async () => {
    const forms = { one: "{count} produkt", few: "{count} produkty", many: "{count} produktów", other: "{count} produktu" };
    const p = new AnthropicProvider(config, fakeFormsClient({ "0": forms }) as never);
    const [res] = await p.translate([pluralReq]);
    expect(res).toEqual({ id: "0", forms });
  });

  it("flags a count-bearing plural form that drops the count placeholder", async () => {
    const forms = { one: "{count} produkt", few: "produkty", many: "{count} produktów", other: "{count} produktu" };
    const p = new AnthropicProvider(config, fakeFormsClient({ "0": forms }) as never);
    const [res] = await p.translate([pluralReq]);
    expect(res!.forms).toBeUndefined();
    expect(res!.error).toMatch(/placeholder/i);
  });

  it("flags a plural result missing a required category", async () => {
    const forms = { one: "{count} produkt", other: "{count} produktu" };
    const p = new AnthropicProvider(config, fakeFormsClient({ "0": forms }) as never);
    const [res] = await p.translate([pluralReq]);
    expect(res!.forms).toBeUndefined();
    expect(res!.error).toMatch(/categor/i);
  });

  it("flags a placeholder mismatch instead of accepting it", async () => {
    const client = fakeClient({ "0": "Salut" });
    const p = new AnthropicProvider(config, client as never);
    const [res] = await p.translate([baseReq]);
    expect(res!.translation).toBeUndefined();
    expect(res!.error).toMatch(/placeholder/i);
  });

  it("flags a maxLength violation", async () => {
    const client = fakeClient({ "0": "Bonjour tout le monde {name}" });
    const p = new AnthropicProvider(config, client as never);
    const [res] = await p.translate([{ ...baseReq, maxLength: 5 }]);
    expect(res!.error).toMatch(/length/i);
  });

  it("splits into batches of batchSize", async () => {
    const client = fakeClient({ "0": "a {name}", "1": "b {name}" });
    const p = new AnthropicProvider({ ...config, batchSize: 1 }, client as never);
    await p.translate([baseReq, { ...baseReq, id: "1" }]);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("retries once on non-JSON, then degrades to per-item errors and reports the raw reply", async () => {
    const client = {
      messages: { create: vi.fn(async () => ({ content: [{ type: "text", text: "not json at all" }] })) },
    };
    const onMalformedReply = vi.fn();
    const p = new AnthropicProvider(config, client as never);
    const [res] = await p.translate([baseReq], undefined, undefined, onMalformedReply);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(res!.translation).toBeUndefined();
    expect(res!.error).toMatch(/malformed JSON/i);
    expect(onMalformedReply).toHaveBeenCalledTimes(2);
    expect(onMalformedReply).toHaveBeenCalledWith("not json at all", 1);
  });

  it("recovers when the retry after a malformed reply succeeds", async () => {
    const client = {
      messages: {
        create: vi.fn()
          .mockResolvedValueOnce({ content: [{ type: "text", text: "not json" }] })
          .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ items: [{ id: "0", translation: "Salut {name}" }] }) }] }),
      },
    };
    const p = new AnthropicProvider(config, client as never);
    const [res] = await p.translate([baseReq]);
    expect(res).toEqual({ id: "0", translation: "Salut {name}" });
  });

  it("throws a clear error when no API key and no injected client", () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider(config)).toThrow(/ANTHROPIC_API_KEY/);
    if (prev) process.env.ANTHROPIC_API_KEY = prev;
  });

  it("complete() sends system+content to the API and returns parsed JSON", async () => {
    const client = {
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: "text", text: JSON.stringify({ items: [{ id: "0", context: "Submit button on login form" }] }) }],
        })),
      },
    };
    const p = new AnthropicProvider(config, client as never);
    const result = await p.complete({
      system: "You are a context writer.",
      content: [{ type: "text", text: "Key: auth.signIn" }],
      schema: { type: "object", properties: { items: { type: "array" } } },
    });
    expect(result).toEqual({ items: [{ id: "0", context: "Submit button on login form" }] });
    expect(client.messages.create).toHaveBeenCalledOnce();
    const call = client.messages.create.mock.calls[0]![0] as Record<string, unknown>;
    expect((call.system as Array<{ text: string }>)[0]!.text).toBe("You are a context writer.");
  });

  it("complete() degrades to {} when the model returns non-JSON", async () => {
    const client = {
      messages: { create: vi.fn(async () => ({ content: [{ type: "text", text: "not json" }] })) },
    };
    const p = new AnthropicProvider(config, client as never);
    const result = await p.complete({
      system: "sys", content: [{ type: "text", text: "prompt" }], schema: {},
    });
    expect(result).toEqual({});
  });

  it("round-trips a request carrying an image and a forced glossary translation", async () => {
    const client = fakeClient({ "0": "Salut {name}" });
    const p = new AnthropicProvider(config, client as never);
    const req: TranslationRequest = {
      ...baseReq,
      glossary: [{ term: "Hi", forced: "Salut" }],
      image: { mediaType: "image/png", base64: "AAAA" },
    };
    const [res] = await p.translate([req]);
    expect(res).toEqual({ id: "0", translation: "Salut {name}" });

    // The user message content must be an array of blocks with the image block included once.
    const calls = client.messages.create.mock.calls as unknown as Array<[{
      messages: { role: string; content: Array<{ type: string; source?: { data: string } }> }[];
    }]>;
    const content = calls[0]![0].messages[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    const images = content.filter((b) => b.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0]!.source!.data).toBe("AAAA");
  });

  it("dedupes the same key's image across multiple target locales", async () => {
    const client = fakeClient({ "0": "Salut {name}", "1": "Hallo {name}" });
    const p = new AnthropicProvider(config, client as never);
    const image = { mediaType: "image/png", base64: "AAAA" };
    await p.translate([
      { ...baseReq, id: "0", targetLocale: "fr", image },
      { ...baseReq, id: "1", targetLocale: "de", image },
    ]);
    const calls = client.messages.create.mock.calls as unknown as Array<[{
      messages: { content: Array<{ type: string }> }[];
    }]>;
    const images = calls[0]![0].messages[0]!.content.filter((b) => b.type === "image");
    expect(images).toHaveLength(1);
  });
});

function makeBatchJobs(): BatchJobSpec[] {
  return [{
    customId: "de#0",
    locale: "de",
    requests: [{
      id: "0", key: "greeting", source: "Hello", sourceLocale: "en",
      targetLocale: "de", placeholders: [],
    }],
  }];
}

describe("AnthropicProvider batches", () => {
  function makeFake(results: Array<{ custom_id: string; result: any }>) {
    const calls: { create?: unknown; canceled?: string } = {};
    const client = {
      messages: {
        create: async () => ({ content: [] }),
        batches: {
          create: async (args: unknown) => { calls.create = args; return { id: "msgbatch_123" }; },
          retrieve: async () => ({
            processing_status: "ended",
            request_counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 },
          }),
          results: async () => (async function* () { yield* results; })(),
          cancel: async (id: string) => { calls.canceled = id; return {}; },
        },
      },
    };
    return { client, calls };
  }
  const config = { provider: "anthropic", model: "claude-sonnet-4-6", batchSize: 50 } as never;

  it("submits one entry per job and returns the batch id", async () => {
    const { client, calls } = makeFake([]);
    const p = new AnthropicProvider(config, client as never);
    const id = await p.submitTranslationBatch(makeBatchJobs());
    expect(id).toBe("msgbatch_123");
    const body = calls.create as { requests: Array<{ custom_id: string; params: { model: string } }> };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]!.custom_id).toBe("de#0");
    expect(body.requests[0]!.params.model).toBe("claude-sonnet-4-6");
  });

  it("maps status and counts", async () => {
    const { client } = makeFake([]);
    const p = new AnthropicProvider(config, client as never);
    const status = await p.translationBatchStatus("msgbatch_123");
    expect(status.status).toBe("ended");
    expect(status.counts.succeeded).toBe(1);
  });

  it("parses succeeded entries and flags malformed and failed ones", async () => {
    const { client } = makeFake([
      { custom_id: "de#0", result: { type: "succeeded", message: { content: [{ type: "text", text: '{"items":[{"id":"0","translation":"Hallo"}]}' }] } } },
      { custom_id: "fr#0", result: { type: "succeeded", message: { content: [{ type: "text", text: "not json at all {{{" }] } } },
      { custom_id: "es#0", result: { type: "errored", error: { type: "api_error", message: "boom" } } },
    ]);
    const p = new AnthropicProvider(config, client as never);
    const outcomes = await p.translationBatchResults("msgbatch_123");
    expect(outcomes.get("de#0")).toEqual({ type: "items", items: [{ id: "0", translation: "Hallo" }] });
    expect(outcomes.get("fr#0")?.type).toBe("malformed");
    expect(outcomes.get("es#0")).toEqual({ type: "failed", error: "boom" });
  });

  it("cancels by id", async () => {
    const { client, calls } = makeFake([]);
    const p = new AnthropicProvider(config, client as never);
    await p.cancelTranslationBatch("msgbatch_123");
    expect(calls.canceled).toBe("msgbatch_123");
  });
});
