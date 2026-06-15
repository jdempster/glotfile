import { describe, it, expect, vi } from "vitest";
import { validateTranslation, validatePlural, validateReply, runBatched, parseReplyItems, MalformedReplyError } from "./batch.js";
import type { TranslationRequest } from "./provider.js";

const req = (over: Partial<TranslationRequest> = {}): TranslationRequest => ({
  id: "0", key: "k", source: "Hi {name}", sourceLocale: "en", targetLocale: "fr", placeholders: ["name"], ...over,
});

describe("validateTranslation", () => {
  it("accepts a translation that preserves placeholders and fits maxLength", () => {
    expect(validateTranslation(req({ maxLength: 50 }), "Salut {name}")).toEqual({ id: "0", translation: "Salut {name}" });
  });
  it("rejects an undefined translation", () => {
    expect(validateTranslation(req(), undefined).error).toMatch(/no translation/i);
  });
  it("rejects a placeholder mismatch", () => {
    expect(validateTranslation(req(), "Salut").error).toMatch(/placeholder/i);
  });
  it("rejects a maxLength overflow but still returns the translation so callers can store-with-warning", () => {
    const res = validateTranslation(req({ maxLength: 3 }), "Salut {name}");
    expect(res.error).toMatch(/length/i);
    expect(res.translation).toBe("Salut {name}");
  });
});

describe("runBatched", () => {
  it("splits requests into batches of batchSize and validates every reply", async () => {
    const callBatch = vi.fn(async (batch: TranslationRequest[]) =>
      batch.map((r) => ({ id: r.id, translation: "Salut {name}" })));
    const reqs = [req({ id: "0" }), req({ id: "1" }), req({ id: "2" })];
    const out = await runBatched(reqs, 2, callBatch);
    expect(callBatch).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.translation === "Salut {name}")).toBe(true);
  });

  it("degrades missing ids to per-item errors when callBatch returns fewer items", async () => {
    const callBatch = async () => [];
    const out = await runBatched([req({ id: "0" }), req({ id: "1" })], 5, callBatch);
    expect(out).toHaveLength(2);
    expect(out.every((r) => /no translation/i.test(r.error ?? ""))).toBe(true);
  });

  it("treats a batchSize of 0 as 1 (does not hang or drop items)", async () => {
    const callBatch = async (batch: TranslationRequest[]) => batch.map((r) => ({ id: r.id, translation: "Salut {name}" }));
    const out = await runBatched([req({ id: "0" }), req({ id: "1" })], 0, callBatch);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.translation === "Salut {name}")).toBe(true);
  });

  it("bisects a malformed batch and salvages every item except the poison one", async () => {
    // Item "2" deterministically corrupts the reply of any batch containing it
    // (the real-world shape: an unescaped quote inside one translation).
    const onMalformedReply = vi.fn();
    const callBatch = vi.fn(async (batch: TranslationRequest[]) => {
      if (batch.some((r) => r.id === "2")) throw new MalformedReplyError("corrupt reply");
      return batch.map((r) => ({ id: r.id, translation: "Salut {name}" }));
    });
    const reqs = [req({ id: "0" }), req({ id: "1" }), req({ id: "2" }), req({ id: "3" })];
    const out = await runBatched(reqs, 10, callBatch, undefined, undefined, onMalformedReply);
    expect(out).toEqual([
      { id: "0", translation: "Salut {name}" },
      { id: "1", translation: "Salut {name}" },
      { id: "2", error: "Model returned malformed JSON for this string." },
      { id: "3", translation: "Salut {name}" },
    ]);
    // Every malformed (sub-)batch reports its raw reply: [0,1,2,3] → [2] alone fails twice.
    expect(onMalformedReply).toHaveBeenCalledWith("corrupt reply", 4);
    expect(onMalformedReply).toHaveBeenCalledWith("corrupt reply", 1);
  });

  it("retries a transiently malformed single-item batch once and uses the retry's items", async () => {
    const callBatch = vi.fn()
      .mockRejectedValueOnce(new MalformedReplyError("flake"))
      .mockResolvedValueOnce([{ id: "0", translation: "Salut {name}" }]);
    const out = await runBatched([req({ id: "0" })], 5, callBatch);
    expect(callBatch).toHaveBeenCalledTimes(2);
    expect(out).toEqual([{ id: "0", translation: "Salut {name}" }]);
  });

  it("gives up on a single item whose retry is also malformed (no infinite loop)", async () => {
    const onMalformedReply = vi.fn();
    const callBatch = vi.fn().mockRejectedValue(new MalformedReplyError("not json"));
    const out = await runBatched([req({ id: "0" })], 5, callBatch, undefined, undefined, onMalformedReply);
    expect(callBatch).toHaveBeenCalledTimes(2);
    expect(out).toEqual([{ id: "0", error: "Model returned malformed JSON for this string." }]);
    expect(onMalformedReply).toHaveBeenCalledTimes(2);
    expect(onMalformedReply).toHaveBeenLastCalledWith("not json", 1);
  });

  it("a malformed batch does not affect other batches in the same run", async () => {
    const callBatch = vi.fn(async (batch: TranslationRequest[]) => {
      if (batch[0]!.id === "0") throw new MalformedReplyError("bad");
      return batch.map((r) => ({ id: r.id, translation: "Salut {name}" }));
    });
    const out = await runBatched([req({ id: "0" }), req({ id: "1" })], 1, callBatch);
    expect(out[0]!.error).toMatch(/malformed JSON/i);
    expect(out[1]).toEqual({ id: "1", translation: "Salut {name}" });
  });

  it("propagates non-malformed errors from callBatch unchanged", async () => {
    const callBatch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(runBatched([req()], 5, callBatch)).rejects.toThrow("network down");
    expect(callBatch).toHaveBeenCalledTimes(1);
  });

  it("calls onBatchComplete after each batch with cumulative done count and that batch's results", async () => {
    const calls: Array<{ done: number; total: number; results: unknown[] }> = [];
    const callBatch = async (batch: TranslationRequest[]) => batch.map((r) => ({ id: r.id, translation: "Salut {name}" }));
    const reqs = [req({ id: "0" }), req({ id: "1" }), req({ id: "2" })];
    await runBatched(reqs, 2, callBatch, (done, total, batchResults) => {
      calls.push({ done, total, results: batchResults });
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ done: 2, total: 3 });
    expect(calls[0].results).toHaveLength(2);
    expect(calls[1]).toMatchObject({ done: 3, total: 3 });
    expect(calls[1].results).toHaveLength(1);
  });
});

describe("parseReplyItems", () => {
  it("returns the items array from a well-formed reply", () => {
    expect(parseReplyItems('{"items":[{"id":"0","translation":"Salut"}]}')).toEqual([{ id: "0", translation: "Salut" }]);
  });
  it("throws MalformedReplyError carrying the raw text on invalid JSON", () => {
    // Real-world shape: an unescaped quote inside a translation breaks the string.
    const raw = '{"items":[{"id":"0","translation":"Klicken Sie auf „Neu hinzufügen", }]}';
    expect(() => parseReplyItems(raw)).toThrowError(expect.objectContaining({ name: "MalformedReplyError", raw }));
  });
  it("throws MalformedReplyError on valid JSON without an items array", () => {
    expect(() => parseReplyItems('{"foo":1}')).toThrow(MalformedReplyError);
  });
  it("repairs an unescaped quote pair inside a translation value", () => {
    // Seen in the wild (DE/LT/BG): the model quotes a button label with raw
    // ASCII quotes instead of escaping them, corrupting the JSON string.
    const raw = '{"items":[{"id":"0","translation":"Vom Ausweis gescannt. Tippen Sie auf "Erneut aufnehmen", wenn etwas falsch aussieht."}]}';
    expect(parseReplyItems(raw)).toEqual([
      { id: "0", translation: 'Vom Ausweis gescannt. Tippen Sie auf "Erneut aufnehmen", wenn etwas falsch aussieht.' },
    ]);
  });
  it("repairs an unescaped quoted phrase at the end of a value", () => {
    const raw = '{"items":[{"id":"0","translation":"Tap "Retake""}]}';
    expect(parseReplyItems(raw)).toEqual([{ id: "0", translation: 'Tap "Retake"' }]);
  });
  it("repairs unescaped quotes in one item of a multi-item batch without touching the others", () => {
    const raw = '{"items":[{"id":"0","translation":"Salut"},{"id":"1","translation":"Bakstelėkite "Perfotografuoti", jei kas nors atrodo ne taip."}]}';
    expect(parseReplyItems(raw)).toEqual([
      { id: "0", translation: "Salut" },
      { id: "1", translation: 'Bakstelėkite "Perfotografuoti", jei kas nors atrodo ne taip.' },
    ]);
  });
  it("repairs unescaped quotes inside plural forms", () => {
    const raw = '{"items":[{"id":"0","forms":{"one":"Ein "Tag" übrig","other":"{count} "Tage" übrig"}}]}';
    expect(parseReplyItems(raw)).toEqual([
      { id: "0", forms: { one: 'Ein "Tag" übrig', other: '{count} "Tage" übrig' } },
    ]);
  });
  it("still throws when the reply is unrecoverable", () => {
    expect(() => parseReplyItems("I cannot translate this batch.")).toThrow(MalformedReplyError);
  });
});

const pluralReq = (over: Partial<TranslationRequest> = {}): TranslationRequest =>
  req({ source: "{count} items", plural: { arg: "count", categories: ["one", "other"], sourceForms: { one: "{count} item", other: "{count} items" } }, ...over });

describe("validatePlural", () => {
  it("accepts all required categories with placeholders preserved", () => {
    const res = validatePlural(pluralReq(), { one: "{count} article", other: "{count} articles" });
    expect(res.forms).toEqual({ one: "{count} article", other: "{count} articles" });
  });
  it("rejects a missing required category", () => {
    expect(validatePlural(pluralReq(), { one: "{count} article" }).error).toMatch(/missing plural categories/i);
  });
  it("rejects a count-bearing form (other) that drops the count placeholder", () => {
    expect(validatePlural(pluralReq(), { one: "{count} article", other: "articles" }).error).toMatch(/placeholder/i);
  });
  it("accepts zero/one/two forms that idiomatically omit the count placeholder", () => {
    const arReq = pluralReq({
      plural: { arg: "count", categories: ["zero", "one", "two", "few", "many", "other"], sourceForms: { one: "{count} item", other: "{count} items" } },
    });
    const res = validatePlural(arReq, {
      zero: "no items", one: "one item", two: "both items", few: "{count} items", many: "{count} items", other: "{count} items",
    });
    expect(res.error).toBeUndefined();
    expect(res.forms?.zero).toBe("no items");
    expect(res.forms?.one).toBe("one item");
    expect(res.forms?.two).toBe("both items");
  });
  it("rejects a range category (few) that drops the count placeholder", () => {
    const arReq = pluralReq({
      plural: { arg: "count", categories: ["zero", "one", "two", "few", "many", "other"], sourceForms: { one: "{count} item", other: "{count} items" } },
    });
    const res = validatePlural(arReq, {
      zero: "no items", one: "one item", two: "both items", few: "items", many: "{count} items", other: "{count} items",
    });
    expect(res.error).toMatch(/placeholder.*few|few.*placeholder/i);
  });
  it("rejects a zero form that introduces an unknown placeholder", () => {
    const arReq = pluralReq({
      plural: { arg: "count", categories: ["zero", "one", "other"], sourceForms: { one: "{count} item", other: "{count} items" } },
    });
    expect(validatePlural(arReq, { zero: "{bogus} items", one: "{count} item", other: "{count} items" }).error).toMatch(/placeholder/i);
  });
});

describe("validateReply", () => {
  it("routes scalar items to translation validation", () => {
    expect(validateReply(req(), { id: "0", translation: "Salut {name}" })).toEqual({ id: "0", translation: "Salut {name}" });
  });
  it("routes plural items to forms validation", () => {
    expect(validateReply(pluralReq(), { id: "0", forms: { one: "{count} article", other: "{count} articles" } }).forms)
      .toEqual({ one: "{count} article", other: "{count} articles" });
  });
});
