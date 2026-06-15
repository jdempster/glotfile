import { describe, it, expect, beforeEach } from "vitest";
import { spellValue, spellTokens, ignoreWordsFor, loadDictionary, resetSpellCacheForTests } from "./spell.js";

describe("spellTokens", () => {
  it("returns letter runs and ignores punctuation and numbers", () => {
    expect(spellTokens("Hello, world! 42 cafés")).toEqual(["Hello", "world", "cafés"]);
  });
  it("masks placeholders, tags and printf tokens", () => {
    expect(spellTokens("Hi {name}, see <b>this</b> :token %s")).toEqual(["Hi", "see", "this"]);
  });
  it("masks ICU plural/select blocks entirely", () => {
    expect(spellTokens("Done {count, plural, one {zzqq file} other {zzqq files}}")).toEqual(["Done"]);
  });
  it("keeps hyphenated and apostrophe words together", () => {
    expect(spellTokens("well-known l'été")).toEqual(["well-known", "l'été"]);
  });
});

describe("ignoreWordsFor", () => {
  it("lowercases and splits glossary terms and custom words", () => {
    const set = ignoreWordsFor([{ term: "Acme Corp" }], ["Glotfile"]);
    expect(set.has("acme")).toBe(true);
    expect(set.has("corp")).toBe(true);
    expect(set.has("glotfile")).toBe(true);
  });
  it("includes glossary forced translations", () => {
    const set = ignoreWordsFor([{ term: "Webhook", translations: { fi: "webhookiin" } }]);
    expect(set.has("webhook")).toBe(true);
    expect(set.has("webhookiin")).toBe(true);
  });
});

describe("spell", () => {
  beforeEach(() => resetSpellCacheForTests());

  it("returns null until the dictionary is loaded, then flags misspellings", async () => {
    expect(spellValue("en", "Helllo world", new Set())).toBeNull();
    await loadDictionary("en");
    expect(spellValue("en", "Helllo world", new Set())).toContain("Helllo");
  });

  it("returns [] for correctly spelled text", async () => {
    await loadDictionary("en");
    expect(spellValue("en", "Hello world", new Set())).toEqual([]);
  });

  it("settles to [] for a locale with no installed dictionary", async () => {
    // The first call kicks off the load attempt (pending) …
    expect(spellValue("ja", "whatever", new Set())).toBeNull();
    await loadDictionary("ja");
    // … which fails (dictionary-ja is not installed) and marks it unavailable.
    expect(spellValue("ja", "whatever", new Set())).toEqual([]);
  });

  it("masks placeholders so they are not flagged", async () => {
    await loadDictionary("en");
    expect(spellValue("en", "Hello {nme}", new Set())).toEqual([]);
  });

  it("ignores supplied words (e.g. glossary terms)", async () => {
    await loadDictionary("en");
    expect(spellValue("en", "Glotfile rocks", new Set(["glotfile"]))).toEqual([]);
  });

  it("applies the ignore set at read time, not from cache", async () => {
    await loadDictionary("en");
    // Ignored first → filtered out and cached as raw internally.
    expect(spellValue("en", "Glotfile rocks", new Set(["glotfile"]))).toEqual([]);
    // Same value, empty ignore set → the misspelling must resurface (not stale-cached).
    expect(spellValue("en", "Glotfile rocks", new Set())).toContain("Glotfile");
  });

  it("treats a curly-apostrophe word as a single token", async () => {
    await loadDictionary("en");
    // Both halves are gibberish; with U+2019 support this is ONE token, not two.
    expect(spellValue("en", "Zzqq’Zzww", new Set())).toHaveLength(1);
  });

  it("masks ICU plural/select blocks so selector keywords are not flagged", async () => {
    await loadDictionary("en");
    expect(spellValue("en", "{count, plural, one {apple} other {zzqmx}}", new Set())).toEqual([]);
  });

  it("settles to [] for German (dictionary-de is deliberately not shipped — nspell lacks compound-word support)", async () => {
    expect(spellValue("de", "Passwort Anmeldedaten", new Set())).toBeNull();
    await loadDictionary("de");
    expect(spellValue("de", "Passwort Anmeldedaten", new Set())).toEqual([]);
  });
});
