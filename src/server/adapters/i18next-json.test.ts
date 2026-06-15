import { describe, it, expect } from "vitest";
import { i18nextJson } from "./i18next-json.js";
import { defaultState } from "../schema.js";
import { createKey, setTargetValue, setPluralForms } from "../state.js";

describe("i18next-json collisions", () => {
  it("warns when a scalar key collides with a nested path", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "a", "scalar");
    createKey(s, "a.b", "nested");
    const r = i18nextJson.export(s, { adapter: "i18next-json", path: "{locale}.json" });
    expect(r.warnings.some((w) => w.code === "key-collision" && /a/.test(w.key))).toBe(true);
  });
});

function fixture() {
  const s = defaultState();
  s.config.locales = ["en", "pl"];
  createKey(s, "auth.signIn", "Sign in {name}");
  setTargetValue(s, "auth.signIn", "pl", "Zaloguj {name}");
  createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
  s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
  setPluralForms(s, "cart.items", "pl", { one: "{count} produkt", few: "{count} produkty", many: "{count} produktów", other: "{count} produktu" });
  return s;
}

describe("i18next-json", () => {
  it("writes one JSON file per locale at the templated path", () => {
    const r = i18nextJson.export(fixture(), { adapter: "i18next-json", path: "public/locales/{locale}/translation.json" });
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "public/locales/en/translation.json",
      "public/locales/pl/translation.json",
    ]);
  });

  it("nests scalar keys by dot and converts interpolation to double braces", () => {
    const r = i18nextJson.export(fixture(), { adapter: "i18next-json", path: "{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path === "en.json")!.contents);
    expect(en.auth.signIn).toBe("Sign in {{name}}");
    const pl = JSON.parse(r.files.find((f) => f.path === "pl.json")!.contents);
    expect(pl.auth.signIn).toBe("Zaloguj {{name}}");
  });

  it("emits i18next v4 plural suffixes per stored category", () => {
    const r = i18nextJson.export(fixture(), { adapter: "i18next-json", path: "{locale}.json" });
    const en = JSON.parse(r.files.find((f) => f.path === "en.json")!.contents);
    expect(en.cart).toEqual({ items_one: "{{count}} item", items_other: "{{count}} items" });
    const pl = JSON.parse(r.files.find((f) => f.path === "pl.json")!.contents);
    expect(pl.cart).toEqual({
      items_one: "{{count}} produkt",
      items_few: "{{count}} produkty",
      items_many: "{{count}} produktów",
      items_other: "{{count}} produktu",
    });
  });

  it("re-export is byte-identical (zero diff)", () => {
    const a = i18nextJson.export(fixture(), { adapter: "i18next-json", path: "{locale}.json" });
    const b = i18nextJson.export(fixture(), { adapter: "i18next-json", path: "{locale}.json" });
    expect(b.files).toEqual(a.files);
  });

  it("honors the per-output indent override", () => {
    const r = i18nextJson.export(fixture(), { adapter: "i18next-json", path: "{locale}.json", indent: 4 });
    const en = r.files.find((f) => f.path === "en.json")!.contents;
    expect(en).toContain('\n    "auth"');
  });

  it("honors emptyAs:source by falling back to the source value", () => {
    const s = defaultState();
    s.config.locales = ["en", "pl"];
    createKey(s, "greeting", "Hello");
    const r = i18nextJson.export(s, { adapter: "i18next-json", path: "{locale}.json", emptyAs: "source" });
    const pl = JSON.parse(r.files.find((f) => f.path === "pl.json")!.contents);
    expect(pl.greeting).toBe("Hello");
  });

  it("warns lossy-plural when a scalar value is an ICU plural/select string", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "msg", "{count, plural, one {# item} other {# items}}");
    const r = i18nextJson.export(s, { adapter: "i18next-json", path: "{locale}.json" });
    expect(r.warnings.some((w) => w.code === "lossy-plural" && w.key === "msg")).toBe(true);
  });

  it("warns lossy-literal when a literal would be re-interpolated by i18next", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "tpl", "Dear '{{gardener}}'");
    const r = i18nextJson.export(s, { adapter: "i18next-json", path: "{locale}.json" });
    expect(r.warnings.some((w) => w.code === "lossy-literal" && w.key === "tpl")).toBe(true);
  });

  it("does not warn for a single-brace literal (i18next leaves single braces alone)", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "ok", "See '{site}'");
    const r = i18nextJson.export(s, { adapter: "i18next-json", path: "{locale}.json" });
    expect(r.warnings.some((w) => w.code === "lossy-literal")).toBe(false);
  });
});
