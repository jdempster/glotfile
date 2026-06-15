import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flutterArb } from "./flutter-arb.js";
import { flutterArb as flutterArbParser } from "../import/parsers/flutter-arb.js";
import { defaultState } from "../schema.js";
import { createKey, addNote, setPluralForms } from "../state.js";

function fixture() {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  createKey(s, "auth.signIn", "Sign in {name}");
  s.keys["auth.signIn"]!.context = "Welcome screen CTA.";
  s.keys["auth.signIn"]!.values.fr = { value: "Se connecter {name}", state: "reviewed" };
  return s;
}

function pluralFixture() {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
  s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
  setPluralForms(s, "cart.items", "fr", { one: "{count} article", other: "{count} articles" });
  return s;
}

describe("flutter-arb", () => {
  it("writes one .arb per locale at the templated path", () => {
    const r = flutterArb.export(fixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    expect(r.files.map((f) => f.path).sort()).toEqual(["lib/l10n/app_en.arb", "lib/l10n/app_fr.arb"]);
  });

  it("source locale carries @@locale, values, and @key metadata", () => {
    const r = flutterArb.export(fixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents);
    expect(en["@@locale"]).toBe("en");
    expect(en["auth.signIn"]).toBe("Sign in {name}");
    expect(en["@auth.signIn"]).toEqual({ description: "Welcome screen CTA.", placeholders: { name: {} } });
  });

  it("target locale carries values only (no @key metadata)", () => {
    const r = flutterArb.export(fixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const fr = JSON.parse(r.files.find((f) => f.path.endsWith("app_fr.arb"))!.contents);
    expect(fr["@@locale"]).toBe("fr");
    expect(fr["auth.signIn"]).toBe("Se connecter {name}");
    expect(fr["@auth.signIn"]).toBeUndefined();
  });

  it("re-export is byte-identical (zero diff)", () => {
    const out = flutterArb.export(fixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const again = flutterArb.export(fixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    expect(again.files).toEqual(out.files);
  });

  it("emits ARB plural syntax for a plural key on the source locale", () => {
    const r = flutterArb.export(pluralFixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents);
    expect(en["cart.items"]).toBe("{count, plural, one {{count} item} other {{count} items}}");
    expect(en["@cart.items"]).toMatchObject({ placeholders: { count: {} } });
  });

  it("declares placeholders inside plural form bodies, not just the count arg", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "files.summary", "x", undefined, { plural: { arg: "count" } });
    s.keys["files.summary"]!.values.en!.forms = {
      one: "{name} has {count} file",
      other: "{name} has {count} files",
    };
    const r = flutterArb.export(s, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents);
    expect(en["@files.summary"].placeholders).toEqual({ count: {}, name: {} });
  });

  it("emits ARB plural syntax for a plural key on target locales", () => {
    const r = flutterArb.export(pluralFixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const fr = JSON.parse(r.files.find((f) => f.path.endsWith("app_fr.arb"))!.contents);
    expect(fr["cart.items"]).toBe("{count, plural, one {{count} article} other {{count} articles}}");
  });

  it("omits a plural key in a target locale with no forms", () => {
    const s = pluralFixture();
    delete s.keys["cart.items"]!.values.fr;
    const r = flutterArb.export(s, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const fr = JSON.parse(r.files.find((f) => f.path.endsWith("app_fr.arb"))!.contents);
    expect(fr["cart.items"]).toBeUndefined();
  });

  it("never emits a key's notes into the output", () => {
    const s = fixture();
    addNote(s, "auth.signIn", "INTERNAL-only-note");
    const r = flutterArb.export(s, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    for (const f of r.files) expect(f.contents).not.toContain("INTERNAL-only-note");
  });

  it("omits @@locale when includeLocale is false", () => {
    const r = flutterArb.export(fixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb", includeLocale: false });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents);
    expect(en["@@locale"]).toBeUndefined();
    expect(en["auth.signIn"]).toBe("Sign in {name}");
  });

  it("drops the trailing newline when finalNewline is false", () => {
    const r = flutterArb.export(fixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb", finalNewline: false });
    expect(r.files[0]!.contents.endsWith("}")).toBe(true);
    expect(r.files[0]!.contents.endsWith("}\n")).toBe(false);
  });

  it("emits placeholders without type, ignoring stored placeholder types", () => {
    const s = fixture();
    s.keys["auth.signIn"]!.placeholders = { name: { type: "DateTime", format: "yMd", example: "Sam" } };
    const r = flutterArb.export(s, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents);
    expect(en["@auth.signIn"].placeholders).toEqual({ name: {} });
  });

  it("leaves a plural's count arg as an empty placeholder object", () => {
    const r = flutterArb.export(pluralFixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents);
    expect(en["@cart.items"].placeholders).toEqual({ count: {} });
  });

  it("orders keys alphabetically with each @key adjacent to its key", () => {
    const r = flutterArb.export(fixture(), { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb", includeLocale: false });
    const keys = Object.keys(JSON.parse(r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents));
    expect(keys[0]).toBe("auth.signIn");
    expect(keys[1]).toBe("@auth.signIn");
  });

  it("emits Flutter-canonical locale casing in filenames and @@locale", () => {
    const s = defaultState();
    s.config.locales = ["en", "en-us", "ca-es", "zh-hant-tw"];
    createKey(s, "hello", "Hi");
    for (const l of ["en-us", "ca-es", "zh-hant-tw"]) s.keys["hello"]!.values[l] = { value: "Hi", state: "reviewed" };
    const r = flutterArb.export(s, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const paths = r.files.map((f) => f.path).sort();
    expect(paths).toContain("lib/l10n/app_en_US.arb");
    expect(paths).toContain("lib/l10n/app_ca_ES.arb");
    expect(paths).toContain("lib/l10n/app_zh_Hant_TW.arb");
    const enUs = JSON.parse(r.files.find((f) => f.path.endsWith("app_en_US.arb"))!.contents);
    expect(enUs["@@locale"]).toBe("en_US");
  });

  it("duplicates a locale's file for each configured alias", () => {
    const s = fixture();
    s.config.locales = ["en", "zh-Hans"];
    s.keys["auth.signIn"]!.values["zh-Hans"] = { value: "登录 {name}", state: "reviewed" };
    const r = flutterArb.export(s, {
      adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb",
      includeLocale: false, localeAliases: { "zh-Hans": ["zh", "zh_CN", "zh_TW"] },
    });
    const paths = r.files.map((f) => f.path).sort();
    expect(paths).toContain("lib/l10n/app_zh.arb");
    expect(paths).toContain("lib/l10n/app_zh_CN.arb");
    expect(paths).toContain("lib/l10n/app_zh_TW.arb");
    const hans = r.files.find((f) => f.path.endsWith("app_zh_Hans.arb"))!.contents;
    const cn = r.files.find((f) => f.path.endsWith("app_zh_CN.arb"))!.contents;
    expect(cn).toBe(hans);
  });

  it("rewrites @@locale in alias files to each alias's own code when includeLocale is on", () => {
    const s = fixture();
    s.config.locales = ["en", "zh-Hant"];
    s.keys["auth.signIn"]!.values["zh-Hant"] = { value: "登入 {name}", state: "reviewed" };
    const r = flutterArb.export(s, {
      adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb",
      includeLocale: true, localeAliases: { "zh-Hant": ["zh_TW", "zh_HK"] },
    });
    const tw = JSON.parse(r.files.find((f) => f.path.endsWith("app_zh_TW.arb"))!.contents);
    const hk = JSON.parse(r.files.find((f) => f.path.endsWith("app_zh_HK.arb"))!.contents);
    expect(JSON.parse(r.files.find((f) => f.path.endsWith("app_zh_Hant.arb"))!.contents)["@@locale"]).toBe("zh_Hant");
    expect(tw["@@locale"]).toBe("zh_TW");
    expect(hk["@@locale"]).toBe("zh_HK");
    // the translated body is still copied verbatim from the canonical locale.
    expect(tw["auth.signIn"]).toBe("登入 {name}");
  });

  it("honours an explicit localeCase over the bcp47-underscore default", () => {
    const s = fixture();
    s.config.locales = ["en", "en-us"];
    s.keys["auth.signIn"]!.values["en-us"] = { value: "Sign in {name}", state: "reviewed" };
    const r = flutterArb.export(s, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb", localeCase: "lower-hyphen" });
    const paths = r.files.map((f) => f.path).sort();
    expect(paths).toContain("lib/l10n/app_en-us.arb");
  });

  it("applies a localeMap remap to filename and @@locale", () => {
    const s = fixture();
    s.config.locales = ["en", "zh-hant"];
    s.keys["auth.signIn"]!.values["zh-hant"] = { value: "登录 {name}", state: "reviewed" };
    const r = flutterArb.export(s, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb", localeMap: { "zh-hant": "zh_HK" } });
    const f = r.files.find((x) => x.path.endsWith("app_zh_HK.arb"))!;
    expect(f).toBeDefined();
    expect(JSON.parse(f.contents)["@@locale"]).toBe("zh_HK");
  });

  it("warns when localeMap collapses two locales to one token", () => {
    const s = fixture();
    s.config.locales = ["en", "zh-hant", "zh-hans"];
    for (const l of ["zh-hant", "zh-hans"]) s.keys["auth.signIn"]!.values[l] = { value: "x", state: "reviewed" };
    const r = flutterArb.export(s, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb", localeMap: { "zh-hant": "zh", "zh-hans": "zh" } });
    expect(r.warnings.some((w) => w.code === "locale-collision")).toBe(true);
  });

  it("passes an ICU-apostrophe literal through verbatim and excludes it from @placeholders", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "literal", "Dear {gardener}, see '{site}'");
    const r = flutterArb.export(s, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents);
    // The literal '{site}' is ICU's own escape — it survives byte-for-byte.
    expect(en["literal"]).toBe("Dear {gardener}, see '{site}'");
    // Only the real interpolation is declared; the literal name is not a placeholder.
    expect(en["@literal"].placeholders).toEqual({ gardener: {} });
  });

  it("round-trips an ICU-apostrophe literal (import(export(x)) === x)", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    const value = "Dear {gardener}, see '{site}'";
    createKey(s, "literal", value);
    const r = flutterArb.export(s, { adapter: "flutter-arb", path: "app_{locale}.arb" });
    const dir = mkdtempSync(join(tmpdir(), "glotfile-arb-lit-"));
    writeFileSync(join(dir, "app_en.arb"), r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents);
    const parsed = flutterArbParser.parse(dir);
    expect(parsed.keys["literal"]!.values["en"]).toBe(value);
  });
});

