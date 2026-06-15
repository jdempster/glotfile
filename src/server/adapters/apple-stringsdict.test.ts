import { describe, it, expect } from "vitest";
import { appleStringsdict } from "./apple-stringsdict.js";
import { defaultState } from "../schema.js";
import { createKey, setPluralForms } from "../state.js";

function fixture() {
  const s = defaultState();
  s.config.locales = ["en", "pl"];
  createKey(s, "auth.signIn", "Sign in"); // scalar — must be skipped
  createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
  s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
  setPluralForms(s, "cart.items", "pl", { one: "{count} produkt", few: "{count} produkty", many: "{count} produktów", other: "{count} produktu" });
  return s;
}

describe("apple-stringsdict", () => {
  it("writes one .stringsdict per locale", () => {
    const r = appleStringsdict.export(fixture(), { adapter: "apple-stringsdict", path: "{locale}.lproj/Localizable.stringsdict" });
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "en.lproj/Localizable.stringsdict",
      "pl.lproj/Localizable.stringsdict",
    ]);
  });

  it("emits a plural dict with NSStringLocalizedFormatKey and one entry per category", () => {
    const en = appleStringsdict.export(fixture(), { adapter: "apple-stringsdict", path: "{locale}.stringsdict" })
      .files.find((f) => f.path === "en.stringsdict")!.contents;
    expect(en).toContain("<key>cart.items</key>");
    expect(en).toContain("<key>NSStringLocalizedFormatKey</key>");
    expect(en).toContain("<string>%#@count@</string>");
    expect(en).toContain("<key>NSStringFormatSpecTypeKey</key>");
    expect(en).toContain("<string>NSStringPluralRuleType</string>");
    expect(en).toContain("<key>NSStringFormatValueTypeKey</key>");
    expect(en).toContain("<string>d</string>");
    expect(en).toContain("<key>one</key>");
    expect(en).toContain("<string>%d item</string>");
    expect(en).toContain("<key>other</key>");
    expect(en).toContain("<string>%d items</string>");
  });

  it("skips scalar keys (stringsdict is plural-only)", () => {
    const en = appleStringsdict.export(fixture(), { adapter: "apple-stringsdict", path: "{locale}.stringsdict" })
      .files.find((f) => f.path === "en.stringsdict")!.contents;
    expect(en).not.toContain("auth.signIn");
  });

  it("escapes XML special characters in form bodies", () => {
    const s = defaultState();
    createKey(s, "k", "{count} <a> & b", undefined, { plural: { arg: "count" } });
    const r = appleStringsdict.export(s, { adapter: "apple-stringsdict", path: "{locale}.stringsdict" });
    expect(r.files[0]!.contents).toContain("<string>%d &lt;a&gt; &amp; b</string>");
  });

  it("strips literal-span apostrophes and escapes literal % without double-escaping %d", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "promo", "'{site}': {count} off (50%)", undefined, { plural: { arg: "count" } });
    s.keys["promo"]!.values.en!.forms = { one: "'{site}': {count} off (50%)", other: "'{site}': {count} off (50%)" };
    const en = appleStringsdict.export(s, { adapter: "apple-stringsdict", path: "{locale}.stringsdict" })
      .files.find((f) => f.path === "en.stringsdict")!.contents;
    expect(en).toContain("<string>{site}: %d off (50%%)</string>");
  });

  it("emits valid plist scaffolding", () => {
    const en = appleStringsdict.export(fixture(), { adapter: "apple-stringsdict", path: "{locale}.stringsdict" })
      .files.find((f) => f.path === "en.stringsdict")!.contents;
    expect(en.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(en).toContain("<!DOCTYPE plist PUBLIC");
    expect(en.trimEnd().endsWith("</plist>")).toBe(true);
  });
});
