import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider } from "./openai.js";
import type { TranslationRequest } from "./provider.js";
import type { ReplyItem } from "./batch.js";

const config = { provider: "openai" as const, model: "gpt-4o-mini", endpoint: null, batchSize: 25 };

function fakeClient(items: ReplyItem[]) {
  return {
    chat: { completions: { create: vi.fn(async () => ({
      choices: [{ message: { content: JSON.stringify({ items }) } }],
    })) } },
  };
}

const baseReq: TranslationRequest = { id: "0", key: "k", source: "Hi {name}", sourceLocale: "en", targetLocale: "fr", placeholders: ["name"] };

describe("OpenAIProvider", () => {
  it("returns scalar translations parsed from the json_schema reply", async () => {
    const p = new OpenAIProvider(config, fakeClient([{ id: "0", translation: "Salut {name}" }]) as never);
    const [res] = await p.translate([baseReq]);
    expect(res).toEqual({ id: "0", translation: "Salut {name}" });
  });

  it("returns plural forms for a plural request", async () => {
    const pluralReq: TranslationRequest = {
      id: "0", key: "k", source: "{count} items", sourceLocale: "en", targetLocale: "fr", placeholders: ["count"],
      plural: { arg: "count", categories: ["one", "other"], sourceForms: { one: "{count} item", other: "{count} items" } },
    };
    const p = new OpenAIProvider(config, fakeClient([{ id: "0", forms: { one: "{count} article", other: "{count} articles" } }]) as never);
    const [res] = await p.translate([pluralReq]);
    expect(res!.forms).toEqual({ one: "{count} article", other: "{count} articles" });
  });

  it("sends BATCH_SCHEMA via response_format json_schema named 'translations'", async () => {
    const client = fakeClient([{ id: "0", translation: "Salut {name}" }]);
    await new OpenAIProvider(config, client as never).translate([baseReq]);
    const calls = client.chat.completions.create.mock.calls as unknown as Array<[{ response_format: { type: string; json_schema: { name: string } } }]>;
    const args = calls[0]![0];
    expect(args.response_format.type).toBe("json_schema");
    expect(args.response_format.json_schema.name).toBe("translations");
  });

  it("flags a placeholder mismatch (shared validation)", async () => {
    const p = new OpenAIProvider(config, fakeClient([{ id: "0", translation: "Salut" }]) as never);
    const [res] = await p.translate([baseReq]);
    expect(res!.error).toMatch(/placeholder/i);
  });

  it("attaches a screenshot as an image_url data URL", async () => {
    const client = fakeClient([{ id: "0", translation: "Salut {name}" }]);
    const req: TranslationRequest = { ...baseReq, image: { mediaType: "image/png", base64: "AAAA" } };
    await new OpenAIProvider(config, client as never).translate([req]);
    const calls = client.chat.completions.create.mock.calls as unknown as Array<[{ messages: Array<{ role: string; content: unknown }> }]>;
    const args = calls[0]![0];
    const user = args.messages.find((m) => m.role === "user")!;
    const parts = user.content as Array<{ type: string; image_url?: { url: string } }>;
    const img = parts.find((part) => part.type === "image_url");
    expect(img!.image_url!.url).toBe("data:image/png;base64,AAAA");
  });

  it("reports supportsVision true", () => {
    expect(new OpenAIProvider(config, fakeClient([]) as never).supportsVision()).toBe(true);
  });

  it("retries once on non-JSON content, then degrades to per-item errors (no crash)", async () => {
    const client = { chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content: "not json" } }] })) } } };
    const [res] = await new OpenAIProvider(config, client as never).translate([baseReq]);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(res!.error).toMatch(/malformed JSON/i);
  });

  it("throws a clear error when OPENAI_API_KEY is missing and no client injected", () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIProvider(config)).toThrow(/OPENAI_API_KEY/);
    if (prev) process.env.OPENAI_API_KEY = prev;
  });

  it("complete() sends system+content and returns parsed JSON", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: JSON.stringify({ items: [{ id: "0", context: "Login submit" }] }) } }],
          })),
        },
      },
    };
    const p = new OpenAIProvider(config, client as never);
    const result = await p.complete({
      system: "You are a context writer.",
      content: [{ type: "text", text: "Key: auth.signIn" }],
      schema: { type: "object" },
    });
    expect(result).toEqual({ items: [{ id: "0", context: "Login submit" }] });
    const call = client.chat.completions.create.mock.calls[0]![0] as Record<string, unknown>;
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages.find((m) => m.role === "system")!.content).toBe("You are a context writer.");
  });

  it("complete() degrades to {} on non-JSON reply", async () => {
    const client = { chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content: "bad" } }] })) } } };
    const result = await new OpenAIProvider(config, client as never).complete({
      system: "s", content: [{ type: "text", text: "p" }], schema: {},
    });
    expect(result).toEqual({});
  });
});
