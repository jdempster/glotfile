import { describe, it, expect } from "vitest";
import { gettextPo } from "./gettext-po.js";
import { defaultState } from "../schema.js";
import { createKey, setTargetValue, setPluralForms } from "../state.js";

function fixture() {
  const s = defaultState();
  s.config.locales = ["en", "pl"];
  createKey(s, "auth.signIn", "Sign in");
  setTargetValue(s, "auth.signIn", "pl", "Zaloguj");
  createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
  s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
  setPluralForms(s, "cart.items", "pl", { one: "{count} produkt", few: "{count} produkty", many: "{count} produktów", other: "{count} produktu" });
  return s;
}

function contents(r: { files: { path: string; contents: string }[] }, locale: string): string {
  return r.files.find((f) => f.path.includes(`/${locale}/`) || f.path === `${locale}.po`)!.contents;
}

describe("gettext-po", () => {
  it("writes one .po per locale with a Plural-Forms + Language header", () => {
    const r = gettextPo.export(fixture(), { adapter: "gettext-po", path: "locale/{locale}/LC_MESSAGES/messages.po" });
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "locale/en/LC_MESSAGES/messages.po",
      "locale/pl/LC_MESSAGES/messages.po",
    ]);
    const en = contents(r, "en");
    expect(en).toContain('"Language: en\\n"');
    expect(en).toContain('"Plural-Forms: nplurals=2; plural=(n != 1);\\n"');
  });

  it("emits scalar entries with msgctxt/msgid/msgstr", () => {
    const pl = contents(gettextPo.export(fixture(), { adapter: "gettext-po", path: "{locale}.po" }), "pl");
    expect(pl).toContain('msgctxt "auth.signIn"');
    expect(pl).toContain('msgid "Sign in"');
    expect(pl).toContain('msgstr "Zaloguj"');
  });

  it("emits plural entries with msgid/msgid_plural and indexed msgstr; count -> %d", () => {
    const pl = contents(gettextPo.export(fixture(), { adapter: "gettext-po", path: "{locale}.po" }), "pl");
    expect(pl).toContain('msgctxt "cart.items"');
    expect(pl).toContain('msgid "%d item"');
    expect(pl).toContain('msgid_plural "%d items"');
    expect(pl).toContain('msgstr[0] "%d produkt"');
    expect(pl).toContain('msgstr[1] "%d produkty"');
    expect(pl).toContain('msgstr[2] "%d produktów"');
    expect(pl).toContain('msgstr[3] "%d produktu"');
  });

  it("warns once for a sampled (complex) locale, not for simple ones", () => {
    const r = gettextPo.export(fixture(), { adapter: "gettext-po", path: "{locale}.po" });
    expect(r.warnings.filter((w) => w.locale === "pl" && /sampling/.test(w.message))).toHaveLength(1);
    expect(r.warnings.some((w) => w.locale === "en")).toBe(false);
  });

  it("escapes quotes and backslashes", () => {
    const s = defaultState();
    createKey(s, "msg", 'Say "hi" \\ ok');
    const r = gettextPo.export(s, { adapter: "gettext-po", path: "{locale}.po" });
    expect(r.files[0]!.contents).toContain('msgid "Say \\"hi\\" \\\\ ok"');
  });

  it("escapes tab and carriage return", () => {
    const s = defaultState();
    createKey(s, "k", "line\ttab\rcr");
    const r = gettextPo.export(s, { adapter: "gettext-po", path: "{locale}.po" });
    expect(r.files[0]!.contents).toContain('msgid "line\\ttab\\rcr"');
  });

  it("strips literal-span apostrophes and escapes literal % as %%", () => {
    const s = defaultState();
    createKey(s, "promo", "See '{site}' for 50% off");
    const r = gettextPo.export(s, { adapter: "gettext-po", path: "{locale}.po" });
    expect(r.files[0]!.contents).toContain('msgid "See {site} for 50%% off"');
  });

  it("escapes literal % in plural bodies without double-escaping the introduced %d", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "off", "{count} off", undefined, { plural: { arg: "count" } });
    s.keys["off"]!.values.en!.forms = { one: "{count} off (50%)", other: "{count} off (50%)" };
    const r = gettextPo.export(s, { adapter: "gettext-po", path: "{locale}.po" });
    expect(r.files[0]!.contents).toContain('msgid "%d off (50%%)"');
    expect(r.files[0]!.contents).toContain('msgid_plural "%d off (50%%)"');
    expect(r.files[0]!.contents).toContain('msgstr[0] "%d off (50%%)"');
  });

  it("renders the Language header and filename with the configured localeCase", () => {
    const s = defaultState();
    s.config.locales = ["en", "de-de"];
    createKey(s, "greeting", "Hello");
    s.keys["greeting"]!.values["de-de"] = { value: "Hallo", state: "reviewed" };
    const r = gettextPo.export(s, { adapter: "gettext-po", path: "locale/{locale}.po", localeCase: "bcp47-underscore" });
    const de = r.files.find((f) => f.path === "locale/de_DE.po")!;
    expect(de).toBeDefined();
    expect(de.contents).toContain('"Language: de_DE\\n"');
  });
});
