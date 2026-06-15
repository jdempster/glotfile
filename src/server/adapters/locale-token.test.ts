import { describe, it, expect } from "vitest";
import { localeCollisionWarnings } from "./index.js";
import { defaultState } from "../schema.js";
import { createKey, setPluralForms } from "../state.js";
import { i18nextJson } from "./i18next-json.js";
import { vueI18nJson } from "./vue-i18n-json.js";
import { laravelPhp } from "./laravel-php.js";
import { appleStringsdict } from "./apple-stringsdict.js";

describe("localeCollisionWarnings", () => {
  it("warns when two locales resolve to the same token", () => {
    const out = { adapter: "flutter-arb", path: "app_{locale}.arb", localeMap: { "zh-hant": "zh", "zh-hans": "zh" } };
    const ws = localeCollisionWarnings(out, ["en", "zh-hant", "zh-hans"], "bcp47-underscore");
    expect(ws).toHaveLength(1);
    expect(ws[0]!.code).toBe("locale-collision");
    expect(ws[0]!.message).toContain("zh-hant");
    expect(ws[0]!.message).toContain("zh-hans");
    expect(ws[0]!.message).toContain('"zh"');
  });

  it("is silent when every token is unique", () => {
    const out = { adapter: "flutter-arb", path: "app_{locale}.arb" };
    expect(localeCollisionWarnings(out, ["en", "en-us", "fr"], "bcp47-underscore")).toEqual([]);
  });

  it("warns when a lossy localeCase folds two locales to one token", () => {
    // lower-hyphen lowercases, so en-us and en-US both become "en-us".
    const out = { adapter: "flutter-arb", path: "app_{locale}.arb", localeCase: "lower-hyphen" as const };
    const ws = localeCollisionWarnings(out, ["en-us", "en-US"], "bcp47-underscore");
    expect(ws).toHaveLength(1);
    expect(ws[0]!.code).toBe("locale-collision");
  });
});

function twoLocale() {
  const s = defaultState();
  s.config.locales = ["en", "pt-br"];
  createKey(s, "greeting", "Hello");
  s.keys["greeting"]!.values["pt-br"] = { value: "Olá", state: "reviewed" };
  return s;
}

describe("path-only adapters honour localeCase", () => {
  it("each adapter declares a defaultLocaleCase", () => {
    for (const a of [i18nextJson, vueI18nJson, laravelPhp, appleStringsdict]) {
      expect(typeof a.defaultLocaleCase).toBe("string");
    }
  });

  it("i18next renames the file via localeCase", () => {
    const r = i18nextJson.export(twoLocale(), { adapter: "i18next-json", path: "locales/{locale}.json", localeCase: "bcp47-underscore" });
    expect(r.files.map((f) => f.path)).toContain("locales/pt_BR.json");
  });

  it("vue-i18n renames the file via localeCase", () => {
    const r = vueI18nJson.export(twoLocale(), { adapter: "vue-i18n-json", path: "locales/{locale}.json", localeCase: "bcp47-hyphen" });
    expect(r.files.map((f) => f.path)).toContain("locales/pt-BR.json");
  });

  it("laravel renames the lang dir via localeCase", () => {
    const r = laravelPhp.export(twoLocale(), { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php", localeCase: "lower-underscore" });
    expect(r.files.some((f) => f.path.startsWith("lang/pt_br/"))).toBe(true);
  });

  it("apple-stringsdict renames the .lproj dir via localeCase", () => {
    const s = defaultState();
    s.config.locales = ["en", "pt-br"];
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    setPluralForms(s, "cart.items", "pt-br", { one: "{count} item", other: "{count} itens" });
    const r = appleStringsdict.export(s, { adapter: "apple-stringsdict", path: "{locale}.lproj/Localizable.stringsdict", localeCase: "bcp47-hyphen" });
    expect(r.files.map((f) => f.path).some((p) => p.startsWith("pt-BR.lproj/"))).toBe(true);
  });
});
