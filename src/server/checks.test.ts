import { describe, it, expect } from "vitest";
import { runChecks } from "./checks.js";
import { defaultState } from "./schema.js";
import type { State } from "./schema.js";
import { loadDictionary, resetSpellCacheForTests } from "./spell.js";

function stateWith(keys: State["keys"], glossary: State["glossary"] = []): State {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  s.glossary = glossary;
  s.keys = keys;
  return s;
}

describe("runChecks (cheap checks)", () => {
  it("flags a placeholder dropped in a target value", () => {
    const s = stateWith({
      greeting: { values: { en: { value: "Hi {name}", state: "source" }, fr: { value: "Salut", state: "reviewed" } } },
    });
    const { issues } = runChecks(s);
    const ph = issues.filter((i) => i.check === "placeholder");
    expect(ph).toHaveLength(1);
    expect(ph[0]).toMatchObject({ key: "greeting", locale: "fr" });
    expect(ph[0]!.detail).toContain("-name");
  });

  it("does not flag a placeholder when target keeps it", () => {
    const s = stateWith({
      greeting: { values: { en: { value: "Hi {name}", state: "source" }, fr: { value: "Salut {name}", state: "reviewed" } } },
    });
    expect(runChecks(s).issues.filter((i) => i.check === "placeholder")).toHaveLength(0);
  });

  it("flags a target locale that has no value record as untranslated", () => {
    const s = stateWith({
      k: { values: { en: { value: "Hi", state: "source" } } },
    });
    const un = runChecks(s).issues.filter((i) => i.check === "untranslated");
    expect(un).toHaveLength(1);
    expect(un[0]).toMatchObject({ key: "k", locale: "fr" });
  });

  it("flags an empty target value as untranslated", () => {
    const s = stateWith({
      k: { values: { en: { value: "Hi", state: "source" }, fr: { value: "", state: "needs-review" } } },
    });
    const un = runChecks(s).issues.filter((i) => i.check === "untranslated");
    expect(un).toHaveLength(1);
    expect(un[0]).toMatchObject({ key: "k", locale: "fr" });
  });

  it("does not flag untranslated for a translated target or a skipTranslate key", () => {
    const translated = stateWith({
      k: { values: { en: { value: "Hi", state: "source" }, fr: { value: "Salut", state: "reviewed" } } },
    });
    expect(runChecks(translated).issues.filter((i) => i.check === "untranslated")).toHaveLength(0);

    const skipped = stateWith({
      k: { skipTranslate: true, values: { en: { value: "Hi", state: "source" } } },
    });
    expect(runChecks(skipped).issues.filter((i) => i.check === "untranslated")).toHaveLength(0);
  });

  it("flags a value over maxLength (any locale)", () => {
    const s = stateWith({
      k: { maxLength: 3, values: { en: { value: "Hello", state: "source" } } },
    });
    const len = runChecks(s).issues.filter((i) => i.check === "length");
    expect(len).toHaveLength(1);
    expect(len[0]!.detail).toEqual(["5/3"]);
  });

  it("flags a do-not-translate glossary term missing from the translation", () => {
    const s = stateWith(
      { brand: { values: { en: { value: "Open Glotfile", state: "source" }, fr: { value: "Ouvrir Traducteur", state: "reviewed" } } } },
      [{ term: "Glotfile", doNotTranslate: true }],
    );
    const g = runChecks(s).issues.filter((i) => i.check === "glossary");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ key: "brand", locale: "fr" });
  });

  it("flags a forced translation that is not used", () => {
    const s = stateWith(
      { cart: { values: { en: { value: "Add to cart", state: "source" }, fr: { value: "Ajouter", state: "reviewed" } } } },
      [{ term: "cart", translations: { fr: "panier" } }],
    );
    const g = runChecks(s).issues.filter((i) => i.check === "glossary");
    expect(g).toHaveLength(1);
    expect(g[0]!.detail).toEqual(["panier"]);
  });

  it("honors `only` to restrict which checks run", () => {
    const s = stateWith({
      greeting: { maxLength: 1, values: { en: { value: "Hi {name}", state: "source" }, fr: { value: "Salut", state: "reviewed" } } },
    });
    const { issues } = runChecks(s, { only: ["placeholder"] });
    expect(issues.every((i) => i.check === "placeholder")).toBe(true);
  });

  it("returns spellPending false when spelling is not run", () => {
    expect(runChecks(stateWith({})).spellPending).toBe(false);
  });

  it("flags a dropped do-not-translate term, but accepts a case variant", () => {
    // Matching and enforcement are case-insensitive: a lowercased brand counts as kept.
    const kept = stateWith(
      { brand: { values: { en: { value: "Open API docs", state: "source" }, fr: { value: "Ouvrir api docs", state: "reviewed" } } } },
      [{ term: "API", doNotTranslate: true }],
    );
    expect(runChecks(kept).issues.filter((i) => i.check === "glossary")).toHaveLength(0);

    const dropped = stateWith(
      { brand: { values: { en: { value: "Open API docs", state: "source" }, fr: { value: "Ouvrir la doc", state: "reviewed" } } } },
      [{ term: "API", doNotTranslate: true }],
    );
    const g = runChecks(dropped).issues.filter((i) => i.check === "glossary");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ key: "brand", locale: "fr" });
  });
});

describe("runChecks (plural keys)", () => {
  it("does not flag a plural target with a non-empty 'other' form, and does not crash", () => {
    const s = stateWith({
      "cart.items": {
        plural: { arg: "count" },
        values: {
          en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
          fr: { forms: { one: "{count} article", other: "{count} articles" }, state: "reviewed" },
        },
      },
    });
    expect(runChecks(s).issues.filter((i) => i.check === "untranslated")).toHaveLength(0);
  });

  it("flags a plural target with no forms as untranslated", () => {
    const s = stateWith({
      "cart.items": {
        plural: { arg: "count" },
        values: {
          en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
        },
      },
    });
    const un = runChecks(s).issues.filter((i) => i.check === "untranslated");
    expect(un).toHaveLength(1);
    expect(un[0]).toMatchObject({ key: "cart.items", locale: "fr" });
  });

  it("skips scalar content checks (length) on plural keys", () => {
    const s = stateWith({
      "cart.items": {
        plural: { arg: "count" },
        maxLength: 2,
        values: {
          en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
          fr: { forms: { other: "{count} produits" }, state: "reviewed" },
        },
      },
    });
    expect(runChecks(s).issues.filter((i) => i.check === "length")).toHaveLength(0);
  });

  it("flags a count-bearing plural form (other) that drops the source placeholder", () => {
    const s = stateWith({
      "cart.items": {
        plural: { arg: "count" },
        values: {
          en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
          fr: { forms: { one: "{count} article", other: "produits" }, state: "reviewed" },
        },
      },
    });
    const ph = runChecks(s).issues.filter((i) => i.check === "placeholder");
    expect(ph).toHaveLength(1);
    expect(ph[0]).toMatchObject({ key: "cart.items", locale: "fr" });
    expect(ph[0]!.detail).toContain("-count");
  });

  it("flags each count-bearing form (few/many/other) that drops the count, but not the idiomatic 'one'", () => {
    // Mirrors the Polish file.count case: every form drops {count}; only `one` is allowed to.
    const s = stateWith({
      "file.count": {
        plural: { arg: "count" },
        values: {
          en: { forms: { one: "You have {count} file", other: "You have {count} files" }, state: "source" },
          fr: {
            forms: { one: "Masz plik", few: "Masz pliki", many: "Masz plików", other: "Masz pliku" },
            state: "reviewed",
          },
        },
      },
    });
    const ph = runChecks(s).issues.filter((i) => i.check === "placeholder");
    expect(ph).toHaveLength(3);
    expect(ph.map((i) => i.locale)).toEqual(["fr", "fr", "fr"]);
  });

  it("does not flag a count-optional 'one' form that idiomatically drops the count", () => {
    const s = stateWith({
      "cart.items": {
        plural: { arg: "count" },
        values: {
          en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
          fr: { forms: { one: "un article", other: "{count} articles" }, state: "reviewed" },
        },
      },
    });
    expect(runChecks(s).issues.filter((i) => i.check === "placeholder")).toHaveLength(0);
  });

  it("flags a plural form that invents a placeholder absent from the source, even a count-optional 'one'", () => {
    const s = stateWith({
      "cart.items": {
        plural: { arg: "count" },
        values: {
          en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
          fr: { forms: { one: "{bogus} article", other: "{count} articles" }, state: "reviewed" },
        },
      },
    });
    const ph = runChecks(s).issues.filter((i) => i.check === "placeholder");
    expect(ph).toHaveLength(1);
    expect(ph[0]!.detail).toContain("+bogus");
  });

  it("does not flag a plural key when every form keeps the source placeholders", () => {
    const s = stateWith({
      "cart.items": {
        plural: { arg: "count" },
        values: {
          en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
          fr: { forms: { one: "{count} article", other: "{count} articles" }, state: "reviewed" },
        },
      },
    });
    expect(runChecks(s).issues.filter((i) => i.check === "placeholder")).toHaveLength(0);
  });
});

describe("runChecks (spelling)", () => {
  it("reports spellPending until the dictionary is warm, then flags misspellings", async () => {
    resetSpellCacheForTests();
    const s = stateWith({
      k: { values: { en: { value: "Helllo", state: "source" } } },
    });
    const first = runChecks(s, { only: ["spelling"] });
    expect(first.spellPending).toBe(true);
    expect(first.issues).toHaveLength(0);

    await loadDictionary("en");
    const second = runChecks(s, { only: ["spelling"] });
    expect(second.spellPending).toBe(false);
    expect(second.issues.filter((i) => i.check === "spelling")).toHaveLength(1);
  });

  it("does not flag a word that is in the custom dictionary", async () => {
    resetSpellCacheForTests();
    await loadDictionary("en");
    const s = stateWith({ k: { values: { en: { value: "Helllo", state: "source" } } } });
    s.config.spelling = { customWords: ["Helllo"] };
    const issues = runChecks(s, { only: ["spelling"] }).issues.filter((i) => i.check === "spelling");
    expect(issues).toHaveLength(0);
  });

  it("does not run spelling when it is not in `only`", () => {
    resetSpellCacheForTests();
    const s = stateWith({ k: { values: { en: { value: "Helllo", state: "source" } } } });
    expect(runChecks(s, { only: ["placeholder"] }).spellPending).toBe(false);
  });
});
