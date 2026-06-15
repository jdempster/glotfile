import { describe, it, expect } from "vitest";
import { assemble } from "./assemble.js";
import type { ParseResult } from "./types.js";

const parsed: ParseResult = {
  locales: ["en", "fr"],
  keys: {
    "auth.signIn": { values: { en: "Sign in", fr: "Se connecter" } },
    "auth.orphan": { values: { fr: "Orphan" } },
  },
  warnings: [],
};

describe("assemble", () => {
  it("forwards placeholder metadata to the key entry", () => {
    const withMeta: ParseResult = {
      locales: ["en"],
      keys: { greet: { values: { en: "Hi {name}" }, placeholders: { name: { type: "String" } } } },
      warnings: [],
    };
    const state = assemble(withMeta, { sourceLocale: "en", format: "flutter-arb" });
    expect(state.keys["greet"]!.placeholders).toEqual({ name: { type: "String" } });
  });

  it("stamps source locale values as 'source'", () => {
    const state = assemble(parsed, { sourceLocale: "en", format: "vue-i18n-json" });
    expect(state.keys["auth.signIn"]!.values["en"]!.state).toBe("source");
  });

  it("stamps target locale values as 'reviewed'", () => {
    const state = assemble(parsed, { sourceLocale: "en", format: "vue-i18n-json" });
    expect(state.keys["auth.signIn"]!.values["fr"]!.state).toBe("reviewed");
  });

  it("sets config.outputs to the canonical path for the format", () => {
    const state = assemble(parsed, { sourceLocale: "en", format: "laravel-php" });
    expect(state.config.outputs).toEqual([
      { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" },
    ]);
  });

  it("warns when a key has no source-locale value", () => {
    const state = assemble(parsed, { sourceLocale: "en", format: "vue-i18n-json" });
    expect(state.warnings.some((w) => w.includes("auth.orphan"))).toBe(true);
  });

  it("includes all locales sorted", () => {
    const state = assemble(parsed, { sourceLocale: "en", format: "flutter-arb" });
    expect(state.config.locales).toEqual(["en", "fr"]);
  });

  it("converts =N plural forms to CLDR categories when cldr is true", () => {
    const pluralParsed: ParseResult = {
      locales: ["en", "ru"],
      keys: {
        "deliveries.failed": {
          values: {
            en: "{count, plural, =1{delivery} other{deliveries}}",
            ru: "{count, plural, =1{доставка} other{доставки}}",
          },
        },
      },
      warnings: [],
    };
    const state = assemble(pluralParsed, { sourceLocale: "en", format: "flutter-arb", cldr: true });
    const e = state.keys["deliveries.failed"]!;
    expect(e.plural).toEqual({ arg: "count" });
    expect(e.values.en!.forms).toEqual({ one: "delivery", other: "deliveries" });
    expect(e.values.ru!.forms).toEqual({ one: "доставка", few: "доставки", many: "доставки", other: "доставки" });
  });

  it("preserves =N selectors verbatim when cldr is not set (lossless default)", () => {
    const pluralParsed: ParseResult = {
      locales: ["en"],
      keys: { "k": { values: { en: "{count, plural, =1{delivery} other{deliveries}}" } } },
      warnings: [],
    };
    const state = assemble(pluralParsed, { sourceLocale: "en", format: "flutter-arb" });
    expect(state.keys["k"]!.values.en!.forms).toEqual({ "=1": "delivery", other: "deliveries" });
  });

  it("structures a key whose source value is an ICU plural", () => {
    const pluralParsed: ParseResult = {
      locales: ["en", "fr"],
      keys: {
        "deliveries.failed": {
          values: {
            en: "{count, plural, =1{Failed to collect delivery} other{Failed to collect deliveries}}",
            fr: "{count, plural, =1{Échec} other{Échecs}}",
          },
        },
      },
      warnings: [],
    };
    const state = assemble(pluralParsed, { sourceLocale: "en", format: "flutter-arb" });
    const entry = state.keys["deliveries.failed"]!;
    expect(entry.plural).toEqual({ arg: "count" });
    expect(entry.values.en).toEqual({
      forms: { "=1": "Failed to collect delivery", other: "Failed to collect deliveries" },
      state: "source",
    });
    expect(entry.values.fr!.forms).toEqual({ "=1": "Échec", other: "Échecs" });
    expect(entry.values.en!.value).toBeUndefined();
  });

  it("preserves an unparseable plural target under 'other' and warns", () => {
    const mixed: ParseResult = {
      locales: ["en", "de"],
      keys: {
        "deliveries.failed": {
          values: {
            en: "{count, plural, =1{one} other{many}}",
            de: "kein Plural",
          },
        },
      },
      warnings: [],
    };
    const state = assemble(mixed, { sourceLocale: "en", format: "flutter-arb" });
    expect(state.keys["deliveries.failed"]!.values.de!.forms).toEqual({ other: "kein Plural" });
    expect(state.warnings.some((w) => w.includes("deliveries.failed") && w.includes('"de"'))).toBe(true);
  });

  it("leaves a scalar key whose value merely contains 'plural,' as a scalar", () => {
    const scalar: ParseResult = {
      locales: ["en"],
      keys: { "k": { values: { en: "Choose a plural, then continue" } } },
      warnings: [],
    };
    const state = assemble(scalar, { sourceLocale: "en", format: "flutter-arb" });
    expect(state.keys["k"]!.plural).toBeUndefined();
    expect(state.keys["k"]!.values.en!.value).toBe("Choose a plural, then continue");
  });
});

describe("assemble locale inference", () => {
  it("infers no localeCase/localeMap for already-canonical ARB locales", () => {
    const p: ParseResult = { locales: ["en", "fr"], keys: { k: { values: { en: "a", fr: "b" } } }, warnings: [] };
    const state = assemble(p, { sourceLocale: "en", format: "flutter-arb" });
    expect(state.config.outputs[0]).toEqual({ adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
  });

  it("infers a blanket localeCase from underscore vue filenames", () => {
    const p: ParseResult = { locales: ["en_US", "pt_BR"], keys: { k: { values: { en_US: "a", pt_BR: "b" } } }, warnings: [] };
    const state = assemble(p, { sourceLocale: "en_US", format: "vue-i18n-json" });
    expect(state.config.locales).toEqual(["en-us", "pt-br"]);
    expect(state.config.outputs[0]!.localeCase).toBe("bcp47-underscore");
    expect(state.config.outputs[0]!.localeMap).toBeUndefined();
  });

  it("records an outlier in localeMap", () => {
    const p: ParseResult = { locales: ["en-US", "fr-FR", "zh-rHK"], keys: { k: { values: { "en-US": "a" } } }, warnings: [] };
    const state = assemble(p, { sourceLocale: "en-US", format: "vue-i18n-json" });
    expect(state.config.outputs[0]!.localeCase).toBe("bcp47-hyphen");
    expect(state.config.outputs[0]!.localeMap).toEqual({ "zh-rhk": "zh-rHK" });
  });
});
