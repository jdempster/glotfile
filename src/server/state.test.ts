import { describe, it, test, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadState, saveState, canonLocale, createKey, renameKey, deleteKey,
  setSourceValue, setTargetValue, setKeyState, setMetadata,
  applyMachineTranslation, clearValue,
  addLocale, removeLocale, upsertGlossaryEntry, deleteGlossaryEntry,
  addNote, editNote, deleteNote, addCustomWord, removeCustomWord,
  setPluralForms, setSourcePluralForms, convertToPlural, convertToScalar,
  applyMachineTranslationForms, setPluralArg,
  findEmptySourceKeys, pruneEmptySourceKeys,
  mergeGlossarySuggestions, dismissGlossarySuggestion, removeGlossarySuggestion,
} from "./state.js";
import { defaultState, GlotfileError, validate } from "./schema.js";
import { disassemble, assemble } from "./storage.js";

const CLOCK = () => "2026-06-04T10:00:00.000Z";

describe("load/save", () => {
  it("returns defaultState when the file is missing", () => {
    const p = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile.json");
    expect(loadState(p).config.sourceLocale).toBe("en");
  });

  it("round-trips deterministically (zero-diff re-save)", () => {
    const p = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "b.key", "Second");
    createKey(s, "a.key", "First");
    saveState(p, s);
    const first = readFileSync(p, "utf8");
    saveState(p, loadState(p));
    expect(readFileSync(p, "utf8")).toBe(first);
    expect(first.indexOf('"a.key"')).toBeLessThan(first.indexOf('"b.key"'));
  });

  it("trims values on load so existing whitespace is normalized", () => {
    const p = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile.json");
    const raw = {
      version: 1,
      config: {
        sourceLocale: "en",
        locales: ["en", "fr"],
        outputs: [],
        ai: { provider: "anthropic", model: "claude", endpoint: null, batchSize: 25 },
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      keys: {
        k: { values: { en: { value: "  Hi  ", state: "source" }, fr: { value: "   ", state: "reviewed" } } },
      },
    };
    writeFileSync(p, JSON.stringify(raw), "utf8");
    const s = loadState(p);
    expect(s.keys["k"]!.values.en!.value).toBe("Hi");
    expect(s.keys["k"]!.values.fr!.value).toBe("");
  });

  it("loads the example demo glotfile without throwing", () => {
    const demo = join(import.meta.dirname, "..", "..", "examples", "demo.glotfile.json");
    const s = loadState(demo);
    // Locales are normalized to source-first, then alphabetical, on load.
    expect(s.config.locales).toEqual(["en", "de", "es", "fr", "ja"]);
    expect(Object.keys(s.keys).length).toBeGreaterThanOrEqual(12);
  });

  it("normalizes locale case to BCP-47, dedupes, and orders source-first then alphabetical", () => {
    const p = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile.json");
    const s = defaultState();
    s.config.sourceLocale = "en";
    s.config.locales = ["pt", "en", "DE", "en_US", "es", "en-us"];
    saveState(p, s);
    // Underscores canonicalize to hyphens; "en_US" and "en-us" collapse to "en-us".
    expect(loadState(p).config.locales).toEqual(["en", "de", "en-us", "es", "pt"]);
  });

  it("canonicalizes locale keys inside each entry's values, keeping the translation attached", () => {
    const p = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "en_US"];
    createKey(s, "k", "Hi");
    s.keys["k"]!.values["en_US"] = { value: "Howdy", state: "reviewed" };
    saveState(p, s);
    const loaded = loadState(p);
    expect(loaded.config.locales).toEqual(["en", "en-us"]);
    expect(loaded.keys["k"]!.values["en-us"]!.value).toBe("Howdy");
    expect(loaded.keys["k"]!.values["en_US"]).toBeUndefined();
  });

  it("downgrades a version-2 file to version 1 on load", () => {
    const p = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile.json");
    // A version-2 file whose value merely looks like an ICU plural must load
    // verbatim — the v1->v2 plural migration is gone.
    writeFileSync(p, JSON.stringify({
      version: 2,
      config: {
        sourceLocale: "en", locales: ["en"], outputs: [],
        ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 25 },
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      keys: { "k": { values: { en: { value: "{n, plural, one{x} other{y}}", state: "source" } } } },
    }));
    const s = loadState(p);
    expect(s.version).toBe(1);
    expect(s.keys["k"].plural).toBeUndefined();
    expect(s.keys["k"].values["en"].value).toBe("{n, plural, one{x} other{y}}");
    expect(s.keys["k"].values["en"].forms).toBeUndefined();
  });

  it("saves to a glotfile/ directory when storage is 'split' and removes the stale single file", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const p = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "x.key", "Hi");
    saveState(p, s);                      // single first
    expect(readFileSync(p, "utf8").length).toBeGreaterThan(0);
    s.config.storage = "split";
    saveState(p, s);                      // promote
    expect(existsSync(join(dir, "glotfile", "config.json"))).toBe(true);
    expect(existsSync(join(dir, "glotfile", "locales", "en.json"))).toBe(true);
    expect(existsSync(p)).toBe(false);    // stale single file removed
  });

  it("auto-detects and loads a split directory via the logical .json path", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const p = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    s.config.storage = "split";
    createKey(s, "x.key", "Hi");
    saveState(p, s);
    const loaded = loadState(p);          // detects glotfile/ next to glotfile.json
    expect(loaded.keys["x.key"].values["en"].value).toBe("Hi");
    expect(loaded.config.storage).toBe("split");
  });

  it("split round-trip is a zero-diff re-save", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const p = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    s.config.storage = "split";
    createKey(s, "b.key", "B");
    createKey(s, "a.key", "A");
    saveState(p, s);
    const before = readFileSync(join(dir, "glotfile", "locales", "en.json"), "utf8");
    saveState(p, loadState(p));
    expect(readFileSync(join(dir, "glotfile", "locales", "en.json"), "utf8")).toBe(before);
  });

  it("loads from the split directory when both a single file and a split dir exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const p = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en"];
    s.config.storage = "split";
    createKey(s, "x.key", "FromSplit");
    saveState(p, s); // writes glotfile/ dir, removes single file
    // Drop a stray single file with different data next to the split dir.
    writeFileSync(p, JSON.stringify({
      version: 1,
      config: {
        sourceLocale: "en", locales: ["en"], outputs: [],
        ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 25 },
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      keys: { "x.key": { values: { en: { value: "FromSingle", state: "source" } } } },
    }));
    // detectFormat prefers the split directory.
    expect(loadState(p).keys["x.key"].values["en"].value).toBe("FromSplit");
  });
});

describe("loadState (no migration)", () => {
  it("reads a version-1 file verbatim (no conversion even when a value looks like an ICU plural)", () => {
    const p = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile.json");
    writeFileSync(
      p,
      JSON.stringify({
        version: 1,
        config: {
          sourceLocale: "en", locales: ["en"], outputs: [],
          ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
          format: { indent: 2, sortKeys: true, finalNewline: true },
        },
        glossary: [],
        keys: { "cart.items": { values: { en: { value: "{count, plural, one {# item} other {# items}}", state: "source" } } } },
      }),
      "utf8",
    );
    const s = loadState(p);
    expect(s.version).toBe(1);
    expect(s.keys["cart.items"]!.plural).toBeUndefined();
    expect(s.keys["cart.items"]!.values.en!.value).toBe("{count, plural, one {# item} other {# items}}");
    expect(s.keys["cart.items"]!.values.en!.forms).toBeUndefined();
  });
});

describe("mutations", () => {
  it("createKey sets the source value with state source", () => {
    const s = defaultState();
    createKey(s, "auth.signIn", "Sign in");
    expect(s.keys["auth.signIn"]!.values.en).toEqual({ value: "Sign in", state: "source" });
  });

  it("createKey stamps createdAt from the clock", () => {
    const s = defaultState();
    createKey(s, "k", "Hi", () => "2026-06-05T00:00:00.000Z");
    expect(s.keys["k"]!.createdAt).toBe("2026-06-05T00:00:00.000Z");
  });

  it("manual setTargetValue defaults to reviewed", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hi");
    setTargetValue(s, "k", "fr", "Salut", CLOCK);
    expect(s.keys["k"]!.values.fr).toEqual({ value: "Salut", state: "reviewed", updatedAt: CLOCK() });
  });

  it("trims surrounding whitespace on save and folds whitespace-only to an empty string", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr", "es"];
    createKey(s, "k", "  Padded  ");
    expect(s.keys["k"]!.values.en!.value).toBe("Padded");
    setSourceValue(s, "k", "  Hi  ");
    expect(s.keys["k"]!.values.en!.value).toBe("Hi");
    setTargetValue(s, "k", "fr", "   ", CLOCK);
    expect(s.keys["k"]!.values.fr!.value).toBe("");
    applyMachineTranslation(s, "k", "es", "  Salut  ", CLOCK);
    expect(s.keys["k"]!.values.es!.value).toBe("Salut");
  });

  it("applyMachineTranslation writes machine/ai and refuses to overwrite reviewed", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hi");
    applyMachineTranslation(s, "k", "fr", "Salut", CLOCK);
    expect(s.keys["k"]!.values.fr).toEqual({ value: "Salut", state: "machine", source: "ai", updatedAt: CLOCK() });
    setKeyState(s, "k", "fr", "reviewed");
    const changed = applyMachineTranslation(s, "k", "fr", "Bonjour", CLOCK);
    expect(changed).toBe(false);
    expect(s.keys["k"]!.values.fr!.value).toBe("Salut");
  });

  it("applyMachineTranslation with force overwrites a reviewed value", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hi");
    setTargetValue(s, "k", "fr", "Salut", CLOCK);
    expect(applyMachineTranslation(s, "k", "fr", "Bonjour", CLOCK)).toBe(false);
    expect(applyMachineTranslation(s, "k", "fr", "Bonjour", CLOCK, true)).toBe(true);
    expect(s.keys["k"]!.values.fr).toEqual({ value: "Bonjour", state: "machine", source: "ai", updatedAt: CLOCK() });
  });

  it("renameKey moves the entry; deleteKey removes it", () => {
    const s = defaultState();
    createKey(s, "old", "v");
    renameKey(s, "old", "new");
    expect(s.keys["old"]).toBeUndefined();
    expect(s.keys["new"]!.values.en!.value).toBe("v");
    deleteKey(s, "new");
    expect(s.keys["new"]).toBeUndefined();
  });

  it("setMetadata merges partial metadata", () => {
    const s = defaultState();
    createKey(s, "k", "v");
    setMetadata(s, "k", { context: "ctx", tags: ["a"], maxLength: 20 });
    expect(s.keys["k"]!.context).toBe("ctx");
    expect(s.keys["k"]!.maxLength).toBe(20);
  });

  it("setMetadata clears contextSource when writing context (human edit promotes AI-generated context)", () => {
    const s = defaultState();
    createKey(s, "k", "v");
    s.keys["k"]!.contextSource = "ai";
    s.keys["k"]!.context = "Old AI context";
    setMetadata(s, "k", { context: "My edited context" });
    expect(s.keys["k"]!.context).toBe("My edited context");
    expect(s.keys["k"]!.contextSource).toBeUndefined();
  });

  it("setMetadata clears context/tags/maxLength when given empty values", () => {
    const s = defaultState();
    createKey(s, "k", "v");
    setMetadata(s, "k", { context: "ctx", tags: ["a"], maxLength: 20 });

    // Clearing a previously-filled field removes it: empty round-trips as "unset".
    setMetadata(s, "k", { context: "", tags: [], maxLength: null as unknown as number });

    expect(s.keys["k"]!.context).toBeUndefined();
    expect(s.keys["k"]!.tags).toBeUndefined();
    expect(s.keys["k"]!.maxLength).toBeUndefined();
  });

  it("setMetadata does not clear contextSource when context is not being written", () => {
    const s = defaultState();
    createKey(s, "k", "v");
    s.keys["k"]!.contextSource = "ai";
    s.keys["k"]!.context = "AI context";
    setMetadata(s, "k", { tags: ["new-tag"] });
    expect(s.keys["k"]!.contextSource).toBe("ai");
    expect(s.keys["k"]!.context).toBe("AI context");
  });

  it("renameKey to the same name is a no-op", () => {
    const s = defaultState();
    createKey(s, "k", "v");
    expect(() => renameKey(s, "k", "k")).not.toThrow();
    expect(s.keys["k"]!.values.en!.value).toBe("v");
  });

  it("clearValue removes a target locale's value so the key becomes missing for it", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hi");
    setTargetValue(s, "k", "fr", "Salut", CLOCK);
    clearValue(s, "k", "fr");
    expect(s.keys["k"]!.values.fr).toBeUndefined();
    expect(s.keys["k"]!.values.en!.value).toBe("Hi");
  });

  it("clearValue throws when clearing the source locale", () => {
    const s = defaultState();
    createKey(s, "k", "Hi");
    expect(() => clearValue(s, "k", "en")).toThrow(/source value/i);
  });
});

describe("locale mutations", () => {
  it("addLocale adds a new locale and is idempotent", () => {
    const s = defaultState();
    addLocale(s, "fr");
    expect(s.config.locales).toEqual(["en", "fr"]);
    addLocale(s, "fr");
    expect(s.config.locales).toEqual(["en", "fr"]);
  });

  it("addLocale canonicalizes the code to BCP-47 and dedupes case-insensitively", () => {
    const s = defaultState();
    addLocale(s, "EN_US");
    addLocale(s, "en_us");
    addLocale(s, "en-US");
    expect(s.config.locales.filter((l) => l === "en-us")).toEqual(["en-us"]);
  });

  it("removeLocale strips that locale from every key's values", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr", "es"];
    createKey(s, "k", "Hi");
    setTargetValue(s, "k", "fr", "Salut", CLOCK);
    setTargetValue(s, "k", "es", "Hola", CLOCK);
    removeLocale(s, "fr");
    expect(s.config.locales).toEqual(["en", "es"]);
    expect(s.keys["k"]!.values.fr).toBeUndefined();
    expect(s.keys["k"]!.values.es!.value).toBe("Hola");
    expect(s.keys["k"]!.values.en!.value).toBe("Hi");
  });

  it("removeLocale throws when removing the source locale", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    expect(() => removeLocale(s, "en")).toThrow(/source/i);
  });
});

describe("custom dictionary", () => {
  it("addCustomWord appends a trimmed word, deduplicates, and keeps the list sorted", () => {
    const s = defaultState();
    addCustomWord(s, "zebra");
    addCustomWord(s, "  apple ");
    addCustomWord(s, "zebra");
    expect(s.config.spelling!.customWords).toEqual(["apple", "zebra"]);
  });

  it("addCustomWord ignores a blank word", () => {
    const s = defaultState();
    addCustomWord(s, "   ");
    expect(s.config.spelling!.customWords).toEqual([]);
  });

  it("removeCustomWord deletes a word and is a no-op when absent", () => {
    const s = defaultState();
    addCustomWord(s, "apple");
    addCustomWord(s, "zebra");
    removeCustomWord(s, "apple");
    expect(s.config.spelling!.customWords).toEqual(["zebra"]);
    expect(() => removeCustomWord(s, "nope")).not.toThrow();
  });
});

describe("glossary mutations", () => {
  it("upsertGlossaryEntry replaces an existing same-term entry instead of duplicating", () => {
    const s = defaultState();
    upsertGlossaryEntry(s, { term: "Login", doNotTranslate: true });
    upsertGlossaryEntry(s, { term: "Login", notes: "the verb" });
    expect(s.glossary).toHaveLength(1);
    expect(s.glossary[0]).toEqual({ term: "Login", notes: "the verb" });
  });

  it("upsertGlossaryEntry appends a new term", () => {
    const s = defaultState();
    upsertGlossaryEntry(s, { term: "Login" });
    upsertGlossaryEntry(s, { term: "Logout" });
    expect(s.glossary.map((e) => e.term)).toEqual(["Login", "Logout"]);
  });

  it("deleteGlossaryEntry removes by term and is a no-op when absent", () => {
    const s = defaultState();
    upsertGlossaryEntry(s, { term: "Login" });
    deleteGlossaryEntry(s, "Login");
    expect(s.glossary).toHaveLength(0);
    expect(() => deleteGlossaryEntry(s, "Nope")).not.toThrow();
  });
});

describe("notes", () => {
  it("addNote appends an entry with id, text, and clock timestamp", () => {
    const s = defaultState();
    createKey(s, "k", "v");
    const note = addNote(s, "k", "Legal signed off", CLOCK);
    expect(note.text).toBe("Legal signed off");
    expect(note.at).toBe(CLOCK());
    expect(note.id).toMatch(/^n_/);
    expect(s.keys["k"]!.notes).toEqual([note]);
  });

  it("addNote preserves insertion order", () => {
    const s = defaultState();
    createKey(s, "k", "v");
    addNote(s, "k", "first", CLOCK);
    addNote(s, "k", "second", CLOCK);
    expect(s.keys["k"]!.notes!.map((n) => n.text)).toEqual(["first", "second"]);
  });

  it("editNote replaces text but keeps id and at", () => {
    const s = defaultState();
    createKey(s, "k", "v");
    const note = addNote(s, "k", "old", CLOCK);
    editNote(s, "k", note.id, "new");
    expect(s.keys["k"]!.notes![0]).toEqual({ id: note.id, text: "new", at: CLOCK() });
  });

  it("editNote throws on an unknown note id", () => {
    const s = defaultState();
    createKey(s, "k", "v");
    addNote(s, "k", "x", CLOCK);
    expect(() => editNote(s, "k", "n_nope", "y")).toThrow(GlotfileError);
  });

  it("deleteNote removes by id and is a no-op for an unknown id", () => {
    const s = defaultState();
    createKey(s, "k", "v");
    const note = addNote(s, "k", "bye", CLOCK);
    deleteNote(s, "k", note.id);
    expect(s.keys["k"]!.notes).toEqual([]);
    expect(() => deleteNote(s, "k", "n_nope")).not.toThrow();
  });
});

describe("plural state operations", () => {
  function base() {
    const s = defaultState();
    s.config.locales = ["en", "pl"];
    return s;
  }

  it("creates a plural key with the source value seeded as 'other'", () => {
    const s = base();
    createKey(s, "cart.items", "{count} items", CLOCK, { plural: { arg: "count" } });
    expect(s.keys["cart.items"]!.plural).toEqual({ arg: "count" });
    expect(s.keys["cart.items"]!.values.en).toEqual({ forms: { other: "{count} items" }, state: "source" });
  });

  it("sets target plural forms as reviewed with a timestamp", () => {
    const s = base();
    createKey(s, "cart.items", "{count} items", CLOCK, { plural: { arg: "count" } });
    setPluralForms(s, "cart.items", "pl", { one: "{count} produkt", few: "{count} produkty", many: "{count} produktów", other: "{count} produktu" }, CLOCK);
    expect(s.keys["cart.items"]!.values.pl).toEqual({
      forms: { one: "{count} produkt", few: "{count} produkty", many: "{count} produktów", other: "{count} produktu" },
      state: "reviewed",
      updatedAt: "2026-06-04T10:00:00.000Z",
    });
  });

  it("sets source plural forms keeping state 'source'", () => {
    const s = base();
    createKey(s, "cart.items", "{count} items", CLOCK, { plural: { arg: "count" } });
    setSourcePluralForms(s, "cart.items", { one: "{count} item", other: "{count} items" });
    expect(s.keys["cart.items"]!.values.en!.state).toBe("source");
    expect(s.keys["cart.items"]!.values.en!.forms!.one).toBe("{count} item");
  });

  it("rejects scalar setters on a plural key", () => {
    const s = base();
    createKey(s, "cart.items", "{count} items", CLOCK, { plural: { arg: "count" } });
    expect(() => setSourceValue(s, "cart.items", "x")).toThrow(/plural/);
    expect(() => setTargetValue(s, "cart.items", "pl", "x")).toThrow(/plural/);
  });

  it("rejects plural setters on a scalar key", () => {
    const s = base();
    createKey(s, "auth.signIn", "Sign in");
    expect(() => setPluralForms(s, "auth.signIn", "pl", { other: "x" })).toThrow(/not a plural/);
  });
});

describe("convert scalar <-> plural", () => {
  function base() {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    return s;
  }

  it("converts a scalar key to plural, seeding each locale's value as 'other'", () => {
    const s = base();
    createKey(s, "cart.items", "items");
    setTargetValue(s, "cart.items", "fr", "articles", CLOCK);
    convertToPlural(s, "cart.items", "count");
    expect(s.keys["cart.items"]!.plural).toEqual({ arg: "count" });
    expect(s.keys["cart.items"]!.values.en!.forms).toEqual({ other: "items" });
    expect(s.keys["cart.items"]!.values.en!.value).toBeUndefined();
    expect(s.keys["cart.items"]!.values.fr!.forms).toEqual({ other: "articles" });
  });

  it("converts a plural key back to scalar (single form -> its 'other')", () => {
    const s = base();
    createKey(s, "cart.items", "{count} items", CLOCK, { plural: { arg: "count" } });
    convertToScalar(s, "cart.items");
    expect(s.keys["cart.items"]!.plural).toBeUndefined();
    expect(s.keys["cart.items"]!.values.en!.value).toBe("{count} items");
    expect(s.keys["cart.items"]!.values.en!.forms).toBeUndefined();
  });

  it("converts a multi-form plural back to scalar as ICU", () => {
    const s = base();
    createKey(s, "cart.items", "{count} items", CLOCK, { plural: { arg: "count" } });
    setSourcePluralForms(s, "cart.items", { one: "{count} item", other: "{count} items" });
    convertToScalar(s, "cart.items");
    expect(s.keys["cart.items"]!.values.en!.value).toBe("{count, plural, one {{count} item} other {{count} items}}");
  });

  it("throws when converting a plural to plural or a scalar to scalar", () => {
    const s = base();
    createKey(s, "p", "{count} x", CLOCK, { plural: { arg: "count" } });
    createKey(s, "sc", "x");
    expect(() => convertToPlural(s, "p", "count")).toThrow(/already a plural/);
    expect(() => convertToScalar(s, "sc")).toThrow(/not a plural/);
  });
});

describe("applyMachineTranslationForms", () => {
  function base() {
    const s = defaultState();
    s.config.locales = ["en", "pl"];
    createKey(s, "cart.items", "{count} items", CLOCK, { plural: { arg: "count" } });
    return s;
  }

  it("writes machine forms with source 'ai'", () => {
    const s = base();
    const wrote = applyMachineTranslationForms(s, "cart.items", "pl", { one: "{count} produkt", other: "{count} produktu" }, CLOCK);
    expect(wrote).toBe(true);
    expect(s.keys["cart.items"]!.values.pl).toEqual({
      forms: { one: "{count} produkt", other: "{count} produktu" },
      state: "machine",
      source: "ai",
      updatedAt: "2026-06-04T10:00:00.000Z",
    });
  });

  it("does not overwrite a reviewed target", () => {
    const s = base();
    setPluralForms(s, "cart.items", "pl", { other: "{count} produktu" }, CLOCK);
    const wrote = applyMachineTranslationForms(s, "cart.items", "pl", { other: "nope" }, CLOCK);
    expect(wrote).toBe(false);
    expect(s.keys["cart.items"]!.values.pl!.forms!.other).toBe("{count} produktu");
  });

  it("overwrites a reviewed target when force=true", () => {
    const s = base();
    setPluralForms(s, "cart.items", "pl", { other: "{count} produktu" }, CLOCK);
    expect(applyMachineTranslationForms(s, "cart.items", "pl", { other: "x" }, CLOCK)).toBe(false);
    expect(applyMachineTranslationForms(s, "cart.items", "pl", { other: "{count} nowe" }, CLOCK, true)).toBe(true);
    expect(s.keys["cart.items"]!.values.pl).toEqual({
      forms: { other: "{count} nowe" },
      state: "machine",
      source: "ai",
      updatedAt: "2026-06-04T10:00:00.000Z",
    });
  });

  it("scalar applyMachineTranslation rejects a plural key", () => {
    const s = base();
    expect(() => applyMachineTranslation(s, "cart.items", "pl", "x", CLOCK)).toThrow(/plural/);
  });
});

describe("setPluralArg", () => {
  function base() {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    return s;
  }

  it("renames the arg on a plural key, leaving values/forms intact", () => {
    const s = base();
    createKey(s, "cart.items", "{count} items", CLOCK, { plural: { arg: "count" } });
    setSourcePluralForms(s, "cart.items", { one: "{count} item", other: "{count} items" });
    setPluralArg(s, "cart.items", "n");
    expect(s.keys["cart.items"]!.plural).toEqual({ arg: "n" });
    expect(s.keys["cart.items"]!.values.en!.forms).toEqual({ one: "{count} item", other: "{count} items" });
  });

  it("throws a GlotfileError when called on a scalar key", () => {
    const s = base();
    createKey(s, "k", "Hi");
    expect(() => setPluralArg(s, "k", "n")).toThrow(GlotfileError);
  });
});

describe("plural write-boundary hardening", () => {
  function base() {
    const s = defaultState();
    s.config.locales = ["en", "pl"];
    return s;
  }

  it("setMetadata never flips a scalar key to plural (untyped client JSON is stripped)", () => {
    const s = base();
    createKey(s, "k", "Hi");
    // Simulates the API PATCH path where `metadata` is unvalidated client JSON.
    setMetadata(s, "k", { plural: { arg: "count" } } as never);
    expect(s.keys["k"]!.plural).toBeUndefined();
    expect(s.keys["k"]!.values.en!.value).toBe("Hi");
  });

  it("setPluralForms rejects an unknown category", () => {
    const s = base();
    createKey(s, "k", "{count} items", CLOCK, { plural: { arg: "count" } });
    expect(() => setPluralForms(s, "k", "pl", { other: "x", lots: "y" } as never)).toThrow(/category/i);
  });

  it("setPluralForms accepts exact (=N) selectors alongside categories", () => {
    const s = base();
    createKey(s, "k", "{count, plural, =1{one thing} other{many things}}", CLOCK, { plural: { arg: "count" } });
    setPluralForms(s, "k", "pl", { "=1": "jedna rzecz", other: "wiele rzeczy" } as never, CLOCK);
    expect(s.keys["k"]!.values.pl!.forms).toEqual({ "=1": "jedna rzecz", other: "wiele rzeczy" });
  });

  it("setPluralForms rejects forms missing 'other'", () => {
    const s = base();
    createKey(s, "k", "{count} items", CLOCK, { plural: { arg: "count" } });
    expect(() => setPluralForms(s, "k", "pl", { one: "x" })).toThrow(/other/);
  });

  it("plural setters trim form bodies", () => {
    const s = base();
    createKey(s, "k", "{count} items", CLOCK, { plural: { arg: "count" } });
    setPluralForms(s, "k", "pl", { one: "  {count} produkt  ", other: "  {count} produktu  " }, CLOCK);
    expect(s.keys["k"]!.values.pl!.forms).toEqual({ one: "{count} produkt", other: "{count} produktu" });
  });
});

describe("setSourcePluralForms — stale marking", () => {
  function makePluralState() {
    const s = defaultState();
    s.config.locales = ["en", "fr", "de"];
    createKey(s, "items", "{count} item", () => CLOCK(), { plural: { arg: "count" } });
    s.keys["items"]!.values["fr"] = { forms: { one: "un article", other: "{count} articles" }, state: "reviewed", updatedAt: CLOCK() };
    s.keys["items"]!.values["de"] = { forms: { one: "ein Artikel", other: "{count} Artikel" }, state: "machine", updatedAt: CLOCK() };
    return s;
  }

  it("flips reviewed and machine targets to needs-review when plural source forms change", () => {
    const s = makePluralState();
    setSourcePluralForms(s, "items", { one: "{count} item changed", other: "{count} items changed" });
    expect(s.keys["items"]!.values["fr"]!.state).toBe("needs-review");
    expect(s.keys["items"]!.values["de"]!.state).toBe("needs-review");
  });

  it("preserves existing plural forms when flipping to needs-review", () => {
    const s = makePluralState();
    setSourcePluralForms(s, "items", { one: "{count} item changed", other: "{count} items changed" });
    expect(s.keys["items"]!.values["fr"]!.forms).toEqual({ one: "un article", other: "{count} articles" });
  });

  it("does not flip when plural source forms are unchanged (same normalized text)", () => {
    const s = makePluralState();
    // Pass same forms as the initial source (createKey seeds with just the "other" form)
    setSourcePluralForms(s, "items", { other: "{count} item" });
    expect(s.keys["items"]!.values["fr"]!.state).toBe("reviewed");
    expect(s.keys["items"]!.values["de"]!.state).toBe("machine");
  });

  it("does not flip targets that have no forms", () => {
    const s = makePluralState();
    delete s.keys["items"]!.values["de"];
    setSourcePluralForms(s, "items", { one: "changed", other: "changed items" });
    expect(s.keys["items"]!.values["de"]).toBeUndefined();
  });

  it("does not flip targets that are already needs-review", () => {
    const s = makePluralState();
    s.keys["items"]!.values["fr"]!.state = "needs-review";
    setSourcePluralForms(s, "items", { one: "{count} item changed", other: "{count} items changed" });
    expect(s.keys["items"]!.values["fr"]!.state).toBe("needs-review");
  });

  it("does not flip when multi-form source is set to the same forms again", () => {
    const s = makePluralState();
    // Seed source with multi-form, then pass the same forms — should be no-op
    setSourcePluralForms(s, "items", { one: "{count} item", other: "{count} items" });
    // Now fr/de were flipped (forms changed from seed). Reset them to reviewed/machine.
    s.keys["items"]!.values["fr"]!.state = "reviewed";
    s.keys["items"]!.values["de"]!.state = "machine";
    // Pass the exact same forms again — now no flip should happen
    setSourcePluralForms(s, "items", { one: "{count} item", other: "{count} items" });
    expect(s.keys["items"]!.values["fr"]!.state).toBe("reviewed");
    expect(s.keys["items"]!.values["de"]!.state).toBe("machine");
  });
});

describe("setSourceValue — stale marking", () => {
  function makeState() {
    const s = defaultState();
    s.config.locales = ["en", "fr", "de"];
    createKey(s, "k", "Hello");
    s.keys["k"]!.values["fr"] = { value: "Bonjour", state: "reviewed", updatedAt: CLOCK() };
    s.keys["k"]!.values["de"] = { value: "Hallo", state: "machine", updatedAt: CLOCK() };
    return s;
  }

  it("flips reviewed and machine targets to needs-review when source changes meaningfully", () => {
    const s = makeState();
    setSourceValue(s, "k", "Hi there");
    expect(s.keys["k"]!.values["fr"]!.state).toBe("needs-review");
    expect(s.keys["k"]!.values["de"]!.state).toBe("needs-review");
  });

  it("preserves the existing translation text when flipping to needs-review", () => {
    const s = makeState();
    setSourceValue(s, "k", "Hi there");
    expect(s.keys["k"]!.values["fr"]!.value).toBe("Bonjour");
    expect(s.keys["k"]!.values["de"]!.value).toBe("Hallo");
  });

  it("does not flip when source changes only in whitespace or casing", () => {
    const s = makeState();
    setSourceValue(s, "k", "  HELLO  ");
    expect(s.keys["k"]!.values["fr"]!.state).toBe("reviewed");
    expect(s.keys["k"]!.values["de"]!.state).toBe("machine");
  });

  it("does not flip targets that are already needs-review", () => {
    const s = makeState();
    s.keys["k"]!.values["fr"]!.state = "needs-review";
    setSourceValue(s, "k", "Hi there");
    expect(s.keys["k"]!.values["fr"]!.state).toBe("needs-review");
  });

  it("does not flip targets that have no value (empty/missing)", () => {
    const s = makeState();
    delete s.keys["k"]!.values["de"];
    setSourceValue(s, "k", "Hi there");
    expect(s.keys["k"]!.values["de"]).toBeUndefined();
  });

  it("does not flip targets when source is set to the same value again", () => {
    const s = makeState();
    setSourceValue(s, "k", "Hello"); // same as initial value
    expect(s.keys["k"]!.values["fr"]!.state).toBe("reviewed");
    expect(s.keys["k"]!.values["de"]!.state).toBe("machine");
  });
});

describe("findEmptySourceKeys / pruneEmptySourceKeys", () => {
  function withKeys() {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "full", "Hello");          // non-empty scalar
    createKey(s, "blank", "");              // empty scalar
    createKey(s, "spaces", "   ");          // whitespace-only scalar (trims to "")
    createKey(s, "plural.full", "{n} items", CLOCK, { plural: { arg: "n" } });
    createKey(s, "plural.blank", "", CLOCK, { plural: { arg: "n" } }); // empty "other" form
    return s;
  }

  it("finds scalar-empty, whitespace, and empty-plural-other keys, sorted", () => {
    expect(findEmptySourceKeys(withKeys())).toEqual(["blank", "plural.blank", "spaces"]);
  });

  it("leaves populated scalar and plural keys out", () => {
    const found = findEmptySourceKeys(withKeys());
    expect(found).not.toContain("full");
    expect(found).not.toContain("plural.full");
  });

  it("pruneEmptySourceKeys deletes exactly the empty-source keys and returns them", () => {
    const s = withKeys();
    const removed = pruneEmptySourceKeys(s);
    expect(removed).toEqual(["blank", "plural.blank", "spaces"]);
    expect(Object.keys(s.keys).sort()).toEqual(["full", "plural.full"]);
  });

  it("returns an empty array when nothing is empty", () => {
    const s = defaultState();
    createKey(s, "full", "Hello");
    expect(pruneEmptySourceKeys(s)).toEqual([]);
    expect(Object.keys(s.keys)).toEqual(["full"]);
  });
});

describe("canonLocale", () => {
  it("lowercases and hyphenates", () => {
    expect(canonLocale("EN_US")).toBe("en-us");
    expect(canonLocale("zh_Hant_TW")).toBe("zh-hant-tw");
  });
});

describe("normalizeState localeMap keys", () => {
  it("canonicalizes localeMap keys on save", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    try {
      const s = defaultState();
      s.config.locales = ["en", "zh-hant"];
      s.config.outputs = [{ adapter: "flutter-arb", path: "app_{locale}.arb", localeMap: { "ZH_Hant": "zh_HK" } }];
      const path = join(dir, "glotfile.json");
      saveState(path, s);
      const reloaded = loadState(path);
      expect(reloaded.config.outputs[0]!.localeMap).toEqual({ "zh-hant": "zh_HK" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("setKeyState validation", () => {
  it("rejects a state value that is not a known LocaleState", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hi");
    setTargetValue(s, "k", "fr", "Salut", CLOCK);
    // A bogus value would otherwise be persisted and then make loadState throw.
    expect(() => setKeyState(s, "k", "fr", "frozen" as never)).toThrow(GlotfileError);
  });
});

describe("setters canonicalize the locale argument", () => {
  it("setTargetValue writes under the canonical locale, not the raw code", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hi");
    setTargetValue(s, "k", "FR", "Salut", CLOCK);
    expect(s.keys["k"]!.values["fr"]!.value).toBe("Salut");
    expect(s.keys["k"]!.values["FR"]).toBeUndefined();
  });

  it("applyMachineTranslation reviewed-guard is not defeated by a non-canonical code", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hi");
    setTargetValue(s, "k", "fr", "Salut", CLOCK);
    setKeyState(s, "k", "fr", "reviewed");
    expect(applyMachineTranslation(s, "k", "FR", "Bonjour", CLOCK)).toBe(false);
    expect(s.keys["k"]!.values["fr"]!.value).toBe("Salut");
  });

  it("removeLocale removes a locale passed non-canonically", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hi");
    setTargetValue(s, "k", "fr", "Salut", CLOCK);
    removeLocale(s, "FR");
    expect(s.config.locales).toEqual(["en"]);
    expect(s.keys["k"]!.values["fr"]).toBeUndefined();
  });
});

describe("glossarySuggestions", () => {
  it("defaultState has empty glossarySuggestions", () => {
    expect(defaultState().glossarySuggestions).toEqual([]);
  });

  it("validate defaults missing glossarySuggestions to []", () => {
    const s = validate({ version: 1, config: { sourceLocale: "en", locales: ["en"], outputs: [], format: { indent: 2, sortKeys: true, finalNewline: true } }, glossary: [], keys: {} });
    expect(s.glossarySuggestions).toEqual([]);
  });

  it("glossarySuggestions round-trips through split disassemble/assemble", () => {
    const s = defaultState();
    s.glossarySuggestions.push({ term: "Acme", status: "pending", doNotTranslate: true });
    const back = validate(assemble(disassemble(s)));
    expect(back.glossarySuggestions).toEqual(s.glossarySuggestions);
  });
});

function stateWith(glossary: any[], suggestions: any[] = []) {
  const s = defaultState();
  s.glossary = glossary;
  s.glossarySuggestions = suggestions;
  return s;
}

test("merge adds new pending terms", () => {
  const s = stateWith([]);
  const added = mergeGlossarySuggestions(s, [{ term: "Acme", note: "brand", doNotTranslate: true }]);
  expect(added).toHaveLength(1);
  expect(s.glossarySuggestions[0]).toEqual({ term: "Acme", status: "pending", note: "brand", doNotTranslate: true });
});

test("merge skips terms already in glossary (case-insensitive)", () => {
  const s = stateWith([{ term: "Acme" }]);
  expect(mergeGlossarySuggestions(s, [{ term: "acme" }])).toHaveLength(0);
});

test("merge skips terms already pending or dismissed", () => {
  const s = stateWith([], [{ term: "Foo", status: "pending" }, { term: "Bar", status: "dismissed" }]);
  expect(mergeGlossarySuggestions(s, [{ term: "foo" }, { term: "bar" }, { term: "Baz" }])).toHaveLength(1);
  expect(s.glossarySuggestions.map((x) => x.term)).toEqual(["Foo", "Bar", "Baz"]);
});

test("dismiss tombstones a suggestion so re-runs skip it", () => {
  const s = stateWith([], [{ term: "Foo", status: "pending" }]);
  dismissGlossarySuggestion(s, "Foo");
  expect(s.glossarySuggestions[0]!.status).toBe("dismissed");
  expect(mergeGlossarySuggestions(s, [{ term: "foo" }])).toHaveLength(0);
});

test("remove hard-deletes a suggestion (used after accept)", () => {
  const s = stateWith([], [{ term: "Foo", status: "pending" }]);
  removeGlossarySuggestion(s, "Foo");
  expect(s.glossarySuggestions).toHaveLength(0);
});
