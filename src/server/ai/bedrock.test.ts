import { describe, it, expect, vi } from "vitest";
import { BedrockProvider } from "./bedrock.js";
import { BATCH_SCHEMA, type TranslationRequest } from "./provider.js";
import type { ReplyItem } from "./batch.js";

const config = {
  provider: "bedrock" as const, model: "amazon.nova-pro-v1:0",
  endpoint: null, region: "us-east-1", batchSize: 25,
};

// makeCommand is identity, so `send` receives the raw Converse input we built —
// we assert on it directly without needing the real SDK Command class.
function fakeDeps(items: ReplyItem[] | null, textReply?: string) {
  const content = items
    ? [{ toolUse: { name: "emit_translations", input: { items } } }]
    : [{ text: textReply ?? "" }];
  const send = vi.fn(async () => ({ output: { message: { content } } }));
  return { client: { send }, makeCommand: (input: unknown) => input, send };
}

const baseReq: TranslationRequest = { id: "0", key: "k", source: "Hi {name}", sourceLocale: "en", targetLocale: "fr", placeholders: ["name"] };

describe("BedrockProvider", () => {
  it("reads scalar translations from the forced tool-use output", async () => {
    const deps = fakeDeps([{ id: "0", translation: "Salut {name}" }]);
    const [res] = await new BedrockProvider(config, deps).translate([baseReq]);
    expect(res).toEqual({ id: "0", translation: "Salut {name}" });
  });

  it("treats a max_tokens-truncated reply as malformed instead of accepting it", async () => {
    const send = vi.fn(async () => ({
      stopReason: "max_tokens",
      output: { message: { content: [{ toolUse: { name: "emit_translations", input: { items: [{ id: "0", translation: "Salut {name}" }] } } }] } },
    }));
    const deps = { client: { send }, makeCommand: (i: unknown) => i };
    const [res] = await new BedrockProvider(config, deps as never).translate([baseReq]);
    expect(res!.translation).toBeUndefined();
    expect(res!.error).toMatch(/malformed/i);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reads plural forms from the tool-use output", async () => {
    const pluralReq: TranslationRequest = {
      id: "0", key: "k", source: "{count} items", sourceLocale: "en", targetLocale: "fr", placeholders: ["count"],
      plural: { arg: "count", categories: ["one", "other"], sourceForms: { one: "{count} item", other: "{count} items" } },
    };
    const deps = fakeDeps([{ id: "0", forms: { one: "{count} article", other: "{count} articles" } }]);
    const [res] = await new BedrockProvider(config, deps).translate([pluralReq]);
    expect(res!.forms).toEqual({ one: "{count} article", other: "{count} articles" });
  });

  it("forces the emit_translations tool with BATCH_SCHEMA for Nova/Claude", async () => {
    const deps = fakeDeps([{ id: "0", translation: "Salut {name}" }]);
    await new BedrockProvider(config, deps).translate([baseReq]);
    const calls = deps.send.mock.calls as unknown as Array<[{ toolConfig?: { toolChoice: { tool: { name: string } }; tools: Array<{ toolSpec: { name: string; inputSchema: { json: unknown } } }> } }]>;
    const input = calls[0]![0];
    expect(input.toolConfig!.toolChoice.tool.name).toBe("emit_translations");
    expect(input.toolConfig!.tools[0]!.toolSpec.name).toBe("emit_translations");
    expect(input.toolConfig!.tools[0]!.toolSpec.inputSchema.json).toBe(BATCH_SCHEMA);
  });

  it("attaches a screenshot as a Converse image block for a vision model", async () => {
    const deps = fakeDeps([{ id: "0", translation: "Salut {name}" }]);
    const req: TranslationRequest = { ...baseReq, image: { mediaType: "image/png", base64: "AAAA" } };
    await new BedrockProvider(config, deps).translate([req]);
    const calls = deps.send.mock.calls as unknown as Array<[{ messages: Array<{ content: Array<{ image?: { format: string } }> }> }]>;
    const input = calls[0]![0];
    const img = input.messages[0]!.content.find((b) => b.image);
    expect(img!.image!.format).toBe("png");
  });

  it("for a Meta model: no vision, no toolConfig, parses a JSON text reply", async () => {
    const meta = { ...config, model: "meta.llama3-1-70b-instruct-v1:0" };
    const deps = fakeDeps(null, JSON.stringify({ items: [{ id: "0", translation: "Salut {name}" }] }));
    const p = new BedrockProvider(meta, deps);
    expect(p.supportsVision()).toBe(false);
    const [res] = await p.translate([baseReq]);
    expect(res).toEqual({ id: "0", translation: "Salut {name}" });
    const calls = deps.send.mock.calls as unknown as Array<[{ toolConfig?: unknown }]>;
    expect(calls[0]![0].toolConfig).toBeUndefined();
  });

  it("flags a placeholder mismatch from the tool output (shared validation)", async () => {
    const [res] = await new BedrockProvider(config, fakeDeps([{ id: "0", translation: "Salut" }])).translate([baseReq]);
    expect(res!.error).toMatch(/placeholder/i);
  });

  it("throws a clear error when no region is configured and no deps injected", () => {
    const prev = process.env.AWS_REGION;
    delete process.env.AWS_REGION;
    expect(() => new BedrockProvider({ ...config, region: null })).toThrow(/region/i);
    if (prev) process.env.AWS_REGION = prev;
  });

  it("complete() sends system+content via Converse and returns parsed JSON", async () => {
    const send = vi.fn(async () => ({
      output: {
        message: {
          content: [{ toolUse: { name: "emit_completion", input: { items: [{ id: "0", context: "Login submit" }] } } }],
        },
      },
    }));
    const deps = { client: { send }, makeCommand: (input: unknown) => input };
    const p = new BedrockProvider(config, deps);
    const result = await p.complete({
      system: "You are a context writer.",
      content: [{ type: "text", text: "Key: auth.signIn" }],
      schema: { type: "object" },
    });
    expect(result).toEqual({ items: [{ id: "0", context: "Login submit" }] });
    const call = send.mock.calls[0]![0] as Record<string, unknown>;
    expect((call.system as Array<{ text: string }>)[0]!.text).toBe("You are a context writer.");
  });

  it("complete() falls back to text block when no tool-use, degrades to {} on bad JSON", async () => {
    const send = vi.fn(async () => ({
      output: { message: { content: [{ text: "not json" }] } },
    }));
    const result = await new BedrockProvider(config, { client: { send }, makeCommand: (i: unknown) => i }).complete({
      system: "s", content: [{ type: "text", text: "p" }], schema: {},
    });
    expect(result).toEqual({});
  });
});
