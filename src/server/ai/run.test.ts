import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectRequests, applyResults, attachScreenshots, attachScreenshotsForProvider, runLocaleParallel } from "./run.js";
import { defaultState } from "../schema.js";
import { createKey, addNote, setPluralForms } from "../state.js";
import type { TranslationRequest, TranslationResult, TranslationProvider } from "./provider.js";

function fixture() {
  const s = defaultState();
  s.config.locales = ["en", "fr", "de"];
  createKey(s, "k1", "Hi {name}");
  s.keys["k1"]!.values.fr = { value: "Salut {name}", state: "reviewed" };
  createKey(s, "k2", "Bye");
  s.keys["k2"]!.skipTranslate = true;
  return s;
}

const CLOCK = () => "2026-06-04T10:00:00.000Z";

function makeState({ sourceLocale, locales }: { sourceLocale: string; locales: string[] }) {
  const s = defaultState();
  s.config.sourceLocale = sourceLocale;
  s.config.locales = locales;
  createKey(s, "k1", "Hi {name}");
  return s;
}

describe("selectRequests", () => {
  it("selects only-missing target pairs, excludes source, skips skipTranslate keys", () => {
    const reqs = selectRequests(fixture(), { onlyMissing: true });
    expect(reqs.map((r) => `${r.key}:${r.targetLocale}`)).toEqual(["k1:de"]);
  });

  it("locale filter narrows targets", () => {
    const reqs = selectRequests(fixture(), { locales: ["de"] });
    expect(reqs.every((r) => r.targetLocale === "de")).toBe(true);
  });

  it("key glob filter matches", () => {
    const reqs = selectRequests(fixture(), { keyGlob: "k1*" });
    expect(reqs.every((r) => r.key.startsWith("k1"))).toBe(true);
  });

  it("stamps sourceLocale onto every request", () => {
    const state = makeState({ sourceLocale: "en", locales: ["en", "fr"] });
    const reqs = selectRequests(state, {});
    expect(reqs.every((r) => r.sourceLocale === "en")).toBe(true);
  });

  it("states filter selects only targets in the given effective states", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr", "de", "es", "it"];
    createKey(s, "k1", "Hi");
    s.keys["k1"]!.values.fr = { value: "Salut", state: "reviewed" };
    s.keys["k1"]!.values.de = { value: "Hallo", state: "needs-review" };
    s.keys["k1"]!.values.es = { value: "Hola", state: "machine" };
    // it is left missing
    expect(selectRequests(s, { states: ["needs-review"] }).map((r) => r.targetLocale)).toEqual(["de"]);
    expect(selectRequests(s, { states: ["machine", "needs-review"] }).map((r) => r.targetLocale).sort()).toEqual(["de", "es"]);
    expect(selectRequests(s, { states: ["missing"] }).map((r) => r.targetLocale)).toEqual(["it"]);
    // states wins over onlyMissing when both are given
    expect(selectRequests(s, { states: ["reviewed"], onlyMissing: true }).map((r) => r.targetLocale)).toEqual(["fr"]);
  });

  it("attaches verbatim quoted literals from the source, omitting the field when there are none", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "tpl", "Dear '{{gardener}}', see '{{site}}'.");
    createKey(s, "plain", "Hello {name}");
    const reqs = selectRequests(s, { onlyMissing: true });
    expect(reqs.find((r) => r.key === "tpl")!.literals).toEqual(["'{{gardener}}'", "'{{site}}'"]);
    expect(reqs.find((r) => r.key === "plain")!.literals).toBeUndefined();
  });
});

describe("applyResults", () => {
  it("writes machine translations and reports errors", () => {
    const s = fixture();
    const reqs = selectRequests(s, { onlyMissing: true });
    const { written, errors } = applyResults(s, reqs, [{ id: reqs[0]!.id, translation: "Hallo {name}" }], CLOCK);
    expect(written).toBe(1);
    expect(errors).toEqual([]);
    expect(s.keys["k1"]!.values.de).toEqual({ value: "Hallo {name}", state: "machine", source: "ai", updatedAt: CLOCK() });
  });

  it("writes an over-length translation (maxLength is a warning, not a hard discard)", () => {
    const s = fixture();
    const [req] = selectRequests(s, { onlyMissing: false, locales: ["de"], keyGlob: "k1" });
    // Simulate what the pipeline produces after the fix: error set but translation present.
    const result: TranslationResult = { id: req!.id, translation: "Hallo {name}", error: "Exceeds maxLength (12 > 5)." };
    const { written, errors } = applyResults(s, [req!], [result], CLOCK);
    expect(written).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toMatch(/maxLength/i);
    expect(s.keys["k1"]!.values.de?.value).toBe("Hallo {name}");
  });

  it("leaves a reviewed value alone, but overwrites it when force=true", () => {
    const s = fixture();
    const [req] = selectRequests(s, { onlyMissing: false, locales: ["fr"], keyGlob: "k1" });
    const result = [{ id: req!.id, translation: "Bonjour {name}" }];
    expect(applyResults(s, [req!], result, CLOCK).written).toBe(0);
    expect(s.keys["k1"]!.values.fr!.value).toBe("Salut {name}");
    expect(applyResults(s, [req!], result, CLOCK, true).written).toBe(1);
    expect(s.keys["k1"]!.values.fr).toEqual({ value: "Bonjour {name}", state: "machine", source: "ai", updatedAt: CLOCK() });
  });
});

function pluralFixture() {
  const s = defaultState();
  s.config.locales = ["en", "pl"];
  createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
  s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
  return s;
}

describe("selectRequests (plural)", () => {
  it("builds a plural request with the target locale's categories and the source forms", () => {
    const reqs = selectRequests(pluralFixture(), { onlyMissing: true });
    expect(reqs).toHaveLength(1);
    const r = reqs[0]!;
    expect(r.key).toBe("cart.items");
    expect(r.targetLocale).toBe("pl");
    expect(r.source).toBe("{count} items");
    expect(r.plural).toEqual({
      arg: "count",
      categories: ["one", "few", "many", "other"],
      sourceForms: { one: "{count} item", other: "{count} items" },
    });
  });

  it("onlyMissing selects a plural target missing a required category (only 'other' present)", () => {
    const s = pluralFixture();
    // Mimics converting a translated scalar to plural: each locale has only `other`.
    s.keys["cart.items"]!.values.pl = { forms: { other: "{count} produktu" }, state: "machine" };
    expect(selectRequests(s, { onlyMissing: true }).map((r) => r.targetLocale)).toContain("pl");
  });

  it("onlyMissing skips a plural target that has every required category", () => {
    const s = pluralFixture();
    setPluralForms(s, "cart.items", "pl", { one: "{count} produkt", few: "{count} produkty", many: "{count} produktów", other: "{count} produktu" });
    expect(selectRequests(s, { onlyMissing: true })).toHaveLength(0);
  });
});

describe("applyResults (plural)", () => {
  it("writes forms via the forms-aware path", () => {
    const s = pluralFixture();
    const reqs = selectRequests(s, { onlyMissing: true });
    const forms = { one: "{count} produkt", few: "{count} produkty", many: "{count} produktów", other: "{count} produktu" };
    const { written, errors } = applyResults(s, reqs, [{ id: reqs[0]!.id, forms }], CLOCK);
    expect(written).toBe(1);
    expect(errors).toEqual([]);
    expect(s.keys["cart.items"]!.values.pl).toEqual({ forms, state: "machine", source: "ai", updatedAt: CLOCK() });
  });

  it("reports an error when a plural result carries no forms", () => {
    const s = pluralFixture();
    const reqs = selectRequests(s, { onlyMissing: true });
    const { written, errors } = applyResults(s, reqs, [{ id: reqs[0]!.id, error: "boom" }], CLOCK);
    expect(written).toBe(0);
    expect(errors).toEqual([{ key: "cart.items", locale: "pl", error: "boom" }]);
  });
});

describe("selectRequests glossary", () => {
  it("attaches relevant glossary hints to each request", () => {
    const s = fixture();
    s.glossary = [{ term: "Hi", translations: { de: "Hallo" } }];
    const reqs = selectRequests(s, { onlyMissing: true });
    expect(reqs[0]!.glossary).toEqual([{ term: "Hi", doNotTranslate: undefined, forced: "Hallo", notes: undefined }]);
  });
});

describe("attachScreenshots", () => {
  it("sets image for a key with an on-disk screenshot and leaves others untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    // A minimal 1x1 PNG.
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    );
    writeFileSync(join(dir, "shot.png"), pngBytes);

    const s = fixture();
    s.keys["k1"]!.screenshot = "shot.png";
    const reqs: TranslationRequest[] = [
      { id: "0", key: "k1", source: "Hi {name}", sourceLocale: "en", targetLocale: "de", placeholders: ["name"] },
      { id: "1", key: "k2", source: "Bye", sourceLocale: "en", targetLocale: "de", placeholders: [] },
    ];
    attachScreenshots(reqs, s, dir);
    expect(reqs[0]!.image).toEqual({ mediaType: "image/png", base64: pngBytes.toString("base64") });
    expect(reqs[1]!.image).toBeUndefined();
  });
});

describe("notes never reach the AI", () => {
  it("note text is absent from every TranslationRequest", () => {
    const s = fixture();
    addNote(s, "k1", "SECRET-NOTE-do-not-send", CLOCK);
    const reqs = selectRequests(s, {});
    expect(JSON.stringify(reqs)).not.toContain("SECRET-NOTE-do-not-send");
  });
});

// ─── runLocaleParallel ───────────────────────────────────────────────────────

function makeReqs(locales: string[]): TranslationRequest[] {
  return locales.map((locale, i) => ({
    id: String(i),
    key: `k${i}`,
    source: "Hi {name}",
    sourceLocale: "en",
    targetLocale: locale,
    placeholders: ["name"],
  }));
}

function makeProvider(delay = 0): { provider: TranslationProvider; calls: string[][] } {
  const calls: string[][] = [];
  const provider: TranslationProvider = {
    supportsVision: () => false,
    complete: async () => ({}),
    translate: vi.fn(async (reqs: TranslationRequest[], onBatchComplete?: (done: number, total: number, results: TranslationResult[]) => void) => {
      calls.push(reqs.map((r) => r.targetLocale));
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const results = reqs.map((r): TranslationResult => ({ id: r.id, translation: "Salut {name}" }));
      onBatchComplete?.(reqs.length, reqs.length, results);
      return results;
    }),
  };
  return { provider, calls };
}

describe("runLocaleParallel", () => {
  it("returns all results for every locale", async () => {
    const reqs = makeReqs(["fr", "de", "es"]);
    const { provider } = makeProvider();
    const results = await runLocaleParallel(reqs, provider);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.translation === "Salut {name}")).toBe(true);
  });

  it("calls translate once per locale with only that locale's requests", async () => {
    const reqs = makeReqs(["fr", "fr", "de"]);
    reqs[0]!.id = "0"; reqs[1]!.id = "1"; reqs[2]!.id = "2";
    const { provider, calls } = makeProvider();
    await runLocaleParallel(reqs, provider);
    expect(calls).toHaveLength(2);
    const frCall = calls.find((c) => c[0] === "fr")!;
    const deCall = calls.find((c) => c[0] === "de")!;
    expect(frCall).toHaveLength(2);
    expect(deCall).toHaveLength(1);
  });

  it("respects concurrency limit — no more than N locales run at once", async () => {
    const locales = ["fr", "de", "es", "ja", "zh"];
    const reqs = makeReqs(locales);
    let inflight = 0;
    let maxInflight = 0;
    const provider: TranslationProvider = {
      supportsVision: () => false,
      complete: async () => ({}),
      translate: vi.fn(async (batch: TranslationRequest[]) => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 10));
        inflight--;
        return batch.map((r): TranslationResult => ({ id: r.id, translation: "ok" }));
      }),
    };
    await runLocaleParallel(reqs, provider, undefined, 2);
    expect(maxInflight).toBeLessThanOrEqual(2);
  });

  it("fires onBatchComplete with a global done counter summed across locales", async () => {
    const reqs = makeReqs(["fr", "de", "es"]);
    const { provider } = makeProvider();
    const calls: Array<{ done: number; total: number }> = [];
    await runLocaleParallel(reqs, provider, { onBatchComplete: (done, total) => calls.push({ done, total }) });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c.total === 3)).toBe(true);
    const dones = calls.map((c) => c.done).sort((a, b) => a - b);
    expect(dones[dones.length - 1]).toBe(3);
  });

  it("passes the locale to onBatchComplete", async () => {
    const reqs = makeReqs(["fr", "de"]);
    const { provider } = makeProvider();
    const byLocale: Array<string> = [];
    await runLocaleParallel(reqs, provider, {
      onBatchComplete: (_done, _total, _results, locale) => byLocale.push(locale),
    });
    expect(byLocale.sort()).toEqual(["de", "fr"]);
  });

  it("fires onLocaleStart before any batch and onLocaleDone after, once per locale", async () => {
    const reqs = makeReqs(["fr", "de"]);
    const { provider } = makeProvider();
    const events: string[] = [];
    await runLocaleParallel(reqs, provider, {
      onLocaleStart: (locale) => events.push(`start:${locale}`),
      onBatchComplete: (_d, _t, _r, locale) => events.push(`batch:${locale}`),
      onLocaleDone: (locale) => events.push(`done:${locale}`),
    }, 1);
    // Concurrency 1 makes the order deterministic: each locale fully start→batch→done.
    expect(events).toEqual(["start:fr", "batch:fr", "done:fr", "start:de", "batch:de", "done:de"]);
  });

  it("skips onLocaleDone for a locale interrupted by an abort", async () => {
    const reqs = makeReqs(["fr", "de"]);
    const controller = new AbortController();
    const provider: TranslationProvider = {
      supportsVision: () => false,
      complete: async () => ({}),
      translate: vi.fn(async (batch: TranslationRequest[]) => {
        // Abort while the first locale's call is in flight.
        controller.abort();
        return batch.map((r): TranslationResult => ({ id: r.id, translation: "ok" }));
      }),
    };
    const done: string[] = [];
    await runLocaleParallel(reqs, provider, { onLocaleDone: (l) => done.push(l) }, 1, controller.signal);
    expect(done).toEqual([]);
  });

  it("returns an empty array for empty input", async () => {
    const { provider } = makeProvider();
    const results = await runLocaleParallel([], provider);
    expect(results).toEqual([]);
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it("retries a transient provider error (429) and then succeeds", async () => {
    let attempts = 0;
    const provider: TranslationProvider = {
      supportsVision: () => false,
      complete: async () => ({}),
      translate: vi.fn(async (batch: TranslationRequest[]) => {
        attempts++;
        if (attempts === 1) {
          const e = new Error("rate limited") as Error & { status?: number };
          e.status = 429;
          throw e;
        }
        return batch.map((r): TranslationResult => ({ id: r.id, translation: "ok" }));
      }),
    };
    const reqs = makeReqs(["fr"]);
    const results = await runLocaleParallel(reqs, provider, undefined, 1, undefined, 1, { retries: 2, delayMs: () => 0 });
    expect(attempts).toBe(2);
    expect(results).toEqual([{ id: "0", translation: "ok" }]);
  });

  it("does not retry a non-transient error (propagates)", async () => {
    const provider: TranslationProvider = {
      supportsVision: () => false,
      complete: async () => ({}),
      translate: vi.fn(async () => {
        const e = new Error("bad request") as Error & { status?: number };
        e.status = 400;
        throw e;
      }),
    };
    const reqs = makeReqs(["fr"]);
    await expect(
      runLocaleParallel(reqs, provider, undefined, 1, undefined, 1, { retries: 3, delayMs: () => 0 }),
    ).rejects.toThrow(/bad request/);
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  it("parallelizes batches WITHIN one locale up to the concurrency limit", async () => {
    // Six requests, all one locale, batchSize 1 → six batches that may overlap.
    // The old one-worker-per-locale model would run them strictly serially.
    const reqs = Array.from({ length: 6 }, (_, i): TranslationRequest => ({
      id: String(i), key: `k${i}`, source: "Hi", sourceLocale: "en", targetLocale: "fr", placeholders: [],
    }));
    let inflight = 0;
    let maxInflight = 0;
    const provider: TranslationProvider = {
      supportsVision: () => false,
      complete: async () => ({}),
      translate: vi.fn(async (batch: TranslationRequest[]) => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 10));
        inflight--;
        return batch.map((r): TranslationResult => ({ id: r.id, translation: "ok" }));
      }),
    };
    const results = await runLocaleParallel(reqs, provider, undefined, 3, undefined, 1);
    expect(results).toHaveLength(6);
    expect(maxInflight).toBe(3);
  });

  it("interleaves batches round-robin across locales so workers spread across languages", async () => {
    // Three locales, two batches each (batchSize 1). The first three batches a
    // pool of 3 workers pick up should be one per locale, not all of the first.
    const reqs = ["fr", "fr", "de", "de", "es", "es"].map((locale, i): TranslationRequest => ({
      id: String(i), key: `k${i}`, source: "Hi", sourceLocale: "en", targetLocale: locale, placeholders: [],
    }));
    const order: string[] = [];
    const provider: TranslationProvider = {
      supportsVision: () => false,
      complete: async () => ({}),
      translate: vi.fn(async (batch: TranslationRequest[]) => {
        order.push(batch[0]!.targetLocale);
        await new Promise((r) => setTimeout(r, 5));
        return batch.map((r): TranslationResult => ({ id: r.id, translation: "ok" }));
      }),
    };
    await runLocaleParallel(reqs, provider, undefined, 3, undefined, 1);
    expect(new Set(order.slice(0, 3))).toEqual(new Set(["fr", "de", "es"]));
  });
});

describe("attachScreenshotsForProvider", () => {
  it("attaches screenshots when the provider supports vision", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    );
    writeFileSync(join(dir, "shot.png"), pngBytes);
    const s = fixture();
    s.keys["k1"]!.screenshot = "shot.png";
    const reqs: TranslationRequest[] = [
      { id: "0", key: "k1", source: "Hi {name}", sourceLocale: "en", targetLocale: "de", placeholders: ["name"] },
    ];
    const { skipped } = attachScreenshotsForProvider(reqs, s, dir, true);
    expect(skipped).toBe(0);
    expect(reqs[0]!.image).toBeDefined();
  });

  it("skips screenshots and counts distinct keys when the provider has no vision", () => {
    const s = fixture();
    s.keys["k1"]!.screenshot = "shot.png";
    const reqs: TranslationRequest[] = [
      { id: "0", key: "k1", source: "Hi {name}", sourceLocale: "en", targetLocale: "fr", placeholders: ["name"] },
      { id: "1", key: "k1", source: "Hi {name}", sourceLocale: "en", targetLocale: "de", placeholders: ["name"] },
    ];
    const { skipped } = attachScreenshotsForProvider(reqs, s, "/nonexistent", false);
    expect(skipped).toBe(1);
    expect(reqs[0]!.image).toBeUndefined();
  });
});
