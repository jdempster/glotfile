import { describe, it, expect } from "vitest";
import { vueI18nJson } from "./vue-i18n-json.js";
import { defaultState } from "../schema.js";
import { createKey, setPluralForms } from "../state.js";

function fixture() {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  createKey(s, "auth.signIn", "Sign in {name}");
  s.keys["auth.signIn"]!.values.fr = { value: "Se connecter {name}", state: "reviewed" };
  createKey(s, "welcome", "Welcome");
  return s;
}

describe("vue-i18n-json", () => {
  it("writes one nested JSON file per locale by default", () => {
    const r = vueI18nJson.export(fixture(), { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json" });
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "resources/locales/en.json",
      "resources/locales/fr.json",
    ]);
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en).toEqual({ auth: { signIn: "Sign in {name}" }, welcome: "Welcome" });
  });

  it("emits flat keys when style is 'flat'", () => {
    const r = vueI18nJson.export(fixture(), { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json", style: "flat" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en).toEqual({ "auth.signIn": "Sign in {name}", welcome: "Welcome" });
  });

  it("omits keys missing in a target locale (runtime falls back to source)", () => {
    const r = vueI18nJson.export(fixture(), { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json" });
    const fr = JSON.parse(r.files.find((f) => f.path.endsWith("fr.json"))!.contents);
    expect(fr).toEqual({ auth: { signIn: "Se connecter {name}" } });
  });

  it("fills empty targets from source when emptyAs is 'source'", () => {
    const r = vueI18nJson.export(fixture(), { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json", emptyAs: "source" });
    const fr = JSON.parse(r.files.find((f) => f.path.endsWith("fr.json"))!.contents);
    expect(fr).toEqual({ auth: { signIn: "Se connecter {name}" }, welcome: "Welcome" });
  });

  it("honours a per-output indent override", () => {
    const r = vueI18nJson.export(fixture(), { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json", indent: 4 });
    const en = r.files.find((f) => f.path.endsWith("en.json"))!.contents;
    expect(en).toContain('\n    "auth": {');
  });

  it("emits vue-i18n pipe-delimited plural for a structured plural key (nested)", () => {
    const s = fixture();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    setPluralForms(s, "cart.items", "fr", { one: "{count} article", other: "{count} articles" });
    const r = vueI18nJson.export(s, { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.cart.items).toBe("{count} item | {count} items");
    const fr = JSON.parse(r.files.find((f) => f.path.endsWith("fr.json"))!.contents);
    expect(fr.cart.items).toBe("{count} article | {count} articles");
  });

  it("emits pipe plural in flat mode", () => {
    const s = fixture();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    const r = vueI18nJson.export(s, { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json", style: "flat" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en["cart.items"]).toBe("{count} item | {count} items");
  });

  it("does not warn lossy-plural for a structured plural key", () => {
    const s = fixture();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    const r = vueI18nJson.export(s, { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json" });
    expect(r.warnings.some((w) => w.key === "cart.items")).toBe(false);
  });

  it("warns (lossy-plural) on an ICU plural string and writes it through", () => {
    const s = fixture();
    createKey(s, "items.count", "{count, plural, one {# item} other {# items}}");
    const r = vueI18nJson.export(s, { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json" });
    expect(r.warnings.some((w) => w.key === "items.count" && w.code === "lossy-plural")).toBe(true);
  });

  it("keeps real {name} slots and converts literal spans to {'...'} interpolation", () => {
    const s = fixture();
    createKey(s, "tour.line", "Dear {gardener}, see '{site}'");
    const r = vueI18nJson.export(s, { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("en.json"))!.contents);
    expect(en.tour.line).toBe("Dear {gardener}, see {'{site}'}");
  });

  it("re-export is byte-identical", () => {
    const a = vueI18nJson.export(fixture(), { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json" });
    const b = vueI18nJson.export(fixture(), { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json" });
    expect(b.files).toEqual(a.files);
  });
});
