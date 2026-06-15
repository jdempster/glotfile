import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeProvider } from "./claudecode.js";
import { makeProvider } from "./index.js";
import type { AiConfig } from "../schema.js";
import type { TranslationRequest } from "./provider.js";
import type { ReplyItem } from "./batch.js";

const config: AiConfig = { provider: "claude-code", model: "claude-sonnet-4-6", endpoint: null, batchSize: 25 };

function fakeSpawn(items: ReplyItem[]) {
  return vi.fn(async () => JSON.stringify({ items }));
}

function fakeSpawnComplete(response: unknown) {
  return vi.fn(async () => JSON.stringify(response));
}

const baseReq: TranslationRequest = { id: "0", key: "k", source: "Hi {name}", sourceLocale: "en", targetLocale: "fr", placeholders: ["name"] };

describe("ClaudeCodeProvider", () => {
  it("translates a batch via the injected spawn function", async () => {
    const spawn = fakeSpawn([{ id: "0", translation: "Salut {name}" }]);
    const p = new ClaudeCodeProvider(config, spawn);
    const [res] = await p.translate([baseReq]);
    expect(res).toEqual({ id: "0", translation: "Salut {name}" });
  });

  it("passes the system prompt and model to the spawn function", async () => {
    const spawn = fakeSpawn([{ id: "0", translation: "Salut {name}" }]);
    const p = new ClaudeCodeProvider(config, spawn);
    await p.translate([baseReq]);
    const [, systemPrompt, model] = spawn.mock.calls[0];
    expect(typeof systemPrompt).toBe("string");
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(model).toBe("claude-sonnet-4-6");
  });

  it("handles markdown code-fenced JSON response from the CLI", async () => {
    const items = [{ id: "0", translation: "Salut {name}" }];
    const spawn = vi.fn(async () => "```json\n" + JSON.stringify({ items }) + "\n```");
    const p = new ClaudeCodeProvider(config, spawn);
    const [res] = await p.translate([baseReq]);
    expect(res).toEqual({ id: "0", translation: "Salut {name}" });
  });

  it("retries once on malformed JSON from spawn, then degrades to per-item errors", async () => {
    const spawn = vi.fn(async () => "not json at all");
    const p = new ClaudeCodeProvider(config, spawn);
    const [res] = await p.translate([baseReq]);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(res.error).toMatch(/malformed JSON/i);
  });

  it("degrades gracefully when spawn rejects", async () => {
    const spawn = vi.fn(async () => { throw new Error("claude not found"); });
    const p = new ClaudeCodeProvider(config, spawn);
    await expect(p.translate([baseReq])).rejects.toThrow("claude not found");
  });

  it("reports supportsVision false", () => {
    const p = new ClaudeCodeProvider(config, fakeSpawn([]));
    expect(p.supportsVision()).toBe(false);
  });

  it("complete() passes the schema in the system prompt and parses the result", async () => {
    const schema = { type: "object", properties: { greeting: { type: "string" } } };
    const spawn = fakeSpawnComplete({ greeting: "Bonjour" });
    const p = new ClaudeCodeProvider(config, spawn);
    const result = await p.complete({ system: "Be helpful", content: [{ type: "text", text: "Translate hi" }], schema });
    expect(result).toEqual({ greeting: "Bonjour" });
    const [, systemPrompt] = spawn.mock.calls[0];
    expect(systemPrompt).toContain(JSON.stringify(schema));
  });

  it("complete() returns {} on malformed JSON from the model", async () => {
    const spawn = vi.fn(async () => "not json");
    const p = new ClaudeCodeProvider(config, spawn);
    const result = await p.complete({ system: "Be helpful", content: [{ type: "text", text: "hi" }], schema: {} });
    expect(result).toEqual({});
  });

  it("handles plural translation requests", async () => {
    const pluralReq: TranslationRequest = {
      id: "1", key: "items", source: "{count} item", sourceLocale: "en", targetLocale: "fr", placeholders: ["count"],
      plural: { arg: "count", categories: ["one", "other"], sourceForms: { one: "{count} item", other: "{count} items" } },
    };
    const spawn = fakeSpawn([{ id: "1", forms: { one: "{count} article", other: "{count} articles" } }]);
    const p = new ClaudeCodeProvider(config, spawn);
    const [res] = await p.translate([pluralReq]);
    expect(res.forms).toEqual({ one: "{count} article", other: "{count} articles" });
  });
});

describe("makeProvider", () => {
  it("returns a ClaudeCodeProvider for provider \"claude-code\"", () => {
    expect(makeProvider(config)).toBeInstanceOf(ClaudeCodeProvider);
  });
});
