import { describe, it, expect } from "vitest";
import { emptySourceRule, emptyTranslationRule, identicalToSourceRule, whitespaceRule, placeholderMismatchRule, icuMismatchRule, maxLengthRule, glossaryViolationRule } from "./rules.js";
import type { LintContext } from "./types.js";
import type { State } from "../schema.js";

function ctx(over: Partial<LintContext> = {}): LintContext {
  return {
    config: {},
    sourceLocale: "en",
    targetLocales: ["fr"],
    glossary: [],
    spellers: new Map(),
    allowWords: new Set(),
    ...over,
  };
}

function state(keys: State["keys"]): State {
  return {
    version: 1,
    config: {
      sourceLocale: "en", locales: ["en", "fr"], outputs: [],
      format: { indent: 2, sortKeys: true, finalNewline: true },
    },
    glossary: [],
    glossarySuggestions: [],
    keys,
  };
}

describe("emptySourceRule", () => {
  it("flags a blank source value", () => {
    const s = state({ "a": { values: { en: { value: "  ", state: "source" } } } });
    const f = emptySourceRule.run(s, ctx());
    expect(f).toEqual([{ ruleId: "empty-source", key: "a", locale: "", message: "source value is empty" }]);
  });
  it("passes a present source value", () => {
    const s = state({ "a": { values: { en: { value: "Hi", state: "source" } } } });
    expect(emptySourceRule.run(s, ctx())).toEqual([]);
  });
  it("passes a plural key whose source has a non-empty other form", () => {
    const s = state({ "a": { plural: { arg: "count" }, values: { en: { forms: { one: "{count} file", other: "{count} files" }, state: "source" } } } });
    expect(emptySourceRule.run(s, ctx())).toEqual([]);
  });
  it("flags a plural key whose source other form is blank", () => {
    const s = state({ "a": { plural: { arg: "count" }, values: { en: { forms: { other: " " }, state: "source" } } } });
    expect(emptySourceRule.run(s, ctx())).toEqual([
      { ruleId: "empty-source", key: "a", locale: "", message: "source value is empty" },
    ]);
  });
});

describe("emptyTranslationRule", () => {
  it("flags an absent target value", () => {
    const s = state({ "a": { values: { en: { value: "Hi", state: "source" } } } });
    const f = emptyTranslationRule.run(s, ctx());
    expect(f).toContainEqual({ ruleId: "empty-translation", key: "a", locale: "fr", message: "translation is empty or missing" });
  });
  it("flags a whitespace-only target value", () => {
    const s = state({ "a": { values: { en: { value: "Hi", state: "source" }, fr: { value: " ", state: "reviewed" } } } });
    const f = emptyTranslationRule.run(s, ctx());
    expect(f).toContainEqual({ ruleId: "empty-translation", key: "a", locale: "fr", message: "translation is empty or missing" });
  });
  it("passes a plural key translated via forms", () => {
    const s = state({
      "a": {
        plural: { arg: "count" },
        values: {
          en: { forms: { one: "{count} file", other: "{count} files" }, state: "source" },
          fr: { forms: { one: "{count} fichier", other: "{count} fichiers" }, state: "machine" },
        },
      },
    });
    expect(emptyTranslationRule.run(s, ctx())).toEqual([]);
  });
  it("flags a plural key whose target lacks an other form", () => {
    const s = state({
      "a": {
        plural: { arg: "count" },
        values: { en: { forms: { other: "{count} files" }, state: "source" } },
      },
    });
    expect(emptyTranslationRule.run(s, ctx())).toEqual([
      { ruleId: "empty-translation", key: "a", locale: "fr", message: "translation is empty or missing" },
    ]);
  });
  it("passes skipTranslate keys with no translations", () => {
    const s = state({ "a": { skipTranslate: true, values: { en: { value: "Glotfile", state: "source" } } } });
    expect(emptyTranslationRule.run(s, ctx())).toEqual([]);
  });
});

describe("identicalToSourceRule", () => {
  it("passes skipTranslate keys (meant to stay identical)", () => {
    const s = state({ "a": { skipTranslate: true, values: { en: { value: "OK", state: "source" }, fr: { value: "OK", state: "reviewed" } } } });
    expect(identicalToSourceRule.run(s, ctx())).toEqual([]);
  });
  it("flags a translation identical to the source", () => {
    const s = state({ "a": { values: { en: { value: "OK", state: "source" }, fr: { value: "OK", state: "reviewed" } } } });
    expect(identicalToSourceRule.run(s, ctx())).toEqual([
      { ruleId: "identical-to-source", key: "a", locale: "fr", message: "translation is identical to the source" },
    ]);
  });
});

describe("whitespaceRule", () => {
  it("flags trailing whitespace the source lacks", () => {
    const s = state({ "a": { values: { en: { value: "Hi", state: "source" }, fr: { value: "Salut ", state: "reviewed" } } } });
    expect(whitespaceRule.run(s, ctx())).toEqual([
      { ruleId: "whitespace", key: "a", locale: "fr", message: "leading/trailing whitespace differs from the source" },
    ]);
  });
});

describe("placeholderMismatchRule", () => {
  it("flags a dropped placeholder", () => {
    const s = state({ "a": { values: { en: { value: "Hi {name}", state: "source" }, fr: { value: "Salut", state: "reviewed" } } } });
    expect(placeholderMismatchRule.run(s, ctx())).toEqual([
      { ruleId: "placeholder-mismatch", key: "a", locale: "fr", message: "placeholders differ from the source" },
    ]);
  });
  it("passes when placeholders match", () => {
    const s = state({ "a": { values: { en: { value: "Hi {name}", state: "source" }, fr: { value: "Salut {name}", state: "reviewed" } } } });
    expect(placeholderMismatchRule.run(s, ctx())).toEqual([]);
  });
  it("flags a plural locale whose count-bearing form drops the count", () => {
    const s = state({ "a": {
      plural: { arg: "count" },
      values: {
        en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
        fr: { forms: { one: "{count} article", other: "articles" }, state: "reviewed" },
      },
    } });
    expect(placeholderMismatchRule.run(s, ctx())).toEqual([
      { ruleId: "placeholder-mismatch", key: "a", locale: "fr", message: "placeholders differ from the source" },
    ]);
  });
  it("does not flag a plural locale whose only dropped count is the idiomatic 'one'", () => {
    const s = state({ "a": {
      plural: { arg: "count" },
      values: {
        en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
        fr: { forms: { one: "un article", other: "{count} articles" }, state: "reviewed" },
      },
    } });
    expect(placeholderMismatchRule.run(s, ctx())).toEqual([]);
  });
});

describe("icuMismatchRule", () => {
  it("flags a translation that drops an ICU plural", () => {
    const s = state({ "a": { values: {
      en: { value: "{n, plural, one {# item} other {# items}}", state: "source" },
      fr: { value: "des articles", state: "reviewed" },
    } } });
    expect(icuMismatchRule.run(s, ctx())).toEqual([
      { ruleId: "icu-mismatch", key: "a", locale: "fr", message: "source is an ICU plural/select but the translation is not" },
    ]);
  });
});

describe("maxLengthRule", () => {
  it("flags a translation longer than maxLength", () => {
    const s = state({ "a": { maxLength: 3, values: { en: { value: "Hi", state: "source" }, fr: { value: "Salut", state: "reviewed" } } } });
    expect(maxLengthRule.run(s, ctx())).toEqual([
      { ruleId: "max-length", key: "a", locale: "fr", message: "length 5 exceeds maxLength 3" },
    ]);
  });
  it("ignores keys without maxLength", () => {
    const s = state({ "a": { values: { en: { value: "Hi", state: "source" }, fr: { value: "Salut", state: "reviewed" } } } });
    expect(maxLengthRule.run(s, ctx())).toEqual([]);
  });
});

describe("glossaryViolationRule", () => {
  it("flags a do-not-translate term that was altered", () => {
    const s = state({ "a": { values: {
      en: { value: "Open Glotfile", state: "source" },
      fr: { value: "Ouvrir Glotfichier", state: "reviewed" },
    } } });
    const c = ctx({ glossary: [{ term: "Glotfile", doNotTranslate: true }] });
    expect(glossaryViolationRule.run(s, c)).toEqual([
      { ruleId: "glossary-violation", key: "a", locale: "fr", message: 'do-not-translate term "Glotfile" is missing or altered' },
    ]);
  });
  it("flags a missing forced translation", () => {
    const s = state({ "a": { values: {
      en: { value: "sign in", state: "source" },
      fr: { value: "ouvrir", state: "reviewed" },
    } } });
    const c = ctx({ glossary: [{ term: "sign in", translations: { fr: "se connecter" } }] });
    expect(glossaryViolationRule.run(s, c)).toEqual([
      { ruleId: "glossary-violation", key: "a", locale: "fr", message: 'expected glossary translation "se connecter" for "sign in"' },
    ]);
  });
  it("passes when the rule is honoured", () => {
    const s = state({ "a": { values: {
      en: { value: "sign in", state: "source" },
      fr: { value: "se connecter", state: "reviewed" },
    } } });
    const c = ctx({ glossary: [{ term: "sign in", translations: { fr: "se connecter" } }] });
    expect(glossaryViolationRule.run(s, c)).toEqual([]);
  });
  it("matches a do-not-translate term case-insensitively", () => {
    const s = state({ "a": { values: {
      en: { value: "Send to a webhook endpoint", state: "source" },
      fi: { value: "Lähetä webhook-päätepisteeseen", state: "reviewed" },
    } } });
    const c = ctx({ targetLocales: ["fi"], glossary: [{ term: "Webhook", doNotTranslate: true }] });
    expect(glossaryViolationRule.run(s, c)).toEqual([]);
  });
  it("matches a forced translation case-insensitively", () => {
    const s = state({ "a": { values: {
      en: { value: "sign in", state: "source" },
      fr: { value: "Se connecter au portail", state: "reviewed" },
    } } });
    const c = ctx({ glossary: [{ term: "sign in", translations: { fr: "se connecter" } }] });
    expect(glossaryViolationRule.run(s, c)).toEqual([]);
  });
  it("no longer flags a case-only difference (matching is case-insensitive)", () => {
    const s = state({ "a": { values: {
      en: { value: "Open the Kiosk", state: "source" },
      fr: { value: "Ouvrir le kiosk", state: "reviewed" },
    } } });
    const c = ctx({ glossary: [{ term: "Kiosk", doNotTranslate: true }] });
    expect(glossaryViolationRule.run(s, c)).toEqual([]);
  });
  it("flags a do-not-translate term governed via an alias when dropped", () => {
    const s = state({ "a": { values: {
      en: { value: "Manage Webhooks", state: "source" },
      de: { value: "Haken verwalten", state: "reviewed" },
    } } });
    const c = ctx({ targetLocales: ["de"], glossary: [{ term: "Webhook", aliases: ["Webhooks"], doNotTranslate: true }] });
    expect(glossaryViolationRule.run(s, c)).toEqual([
      { ruleId: "glossary-violation", key: "a", locale: "de", message: 'do-not-translate term "Webhook" is missing or altered' },
    ]);
  });
});
