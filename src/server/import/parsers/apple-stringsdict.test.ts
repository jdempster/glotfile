import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { appleStringsdict } from "./apple-stringsdict.js";
import { appleStringsdict as appleStringsdictAdapter } from "../../adapters/apple-stringsdict.js";
import { parseIcuPlural } from "../../plurals.js";
import { defaultState } from "../../schema.js";
import { createKey, setPluralForms } from "../../state.js";

const FIXTURE = resolve("test/fixtures/import/apple-stringsdict");

describe("appleStringsdict parser", () => {
  it("reads every <locale>.lproj/Localizable.stringsdict table", () => {
    const r = appleStringsdict.parse(FIXTURE);
    expect(r.locales.sort()).toEqual(["en", "ru"]);
    expect(r.warnings).toEqual([]);
    expect(r.keys["cart.items"]?.values["en"]).toBe(
      "{count, plural, one {{count} item} other {{count} items}}",
    );
  });

  it("preserves every CLDR category a locale defines", () => {
    const r = appleStringsdict.parse(FIXTURE);
    expect(r.keys["cart.items"]?.values["ru"]).toBe(
      "{count, plural, one {{count} товар} few {{count} товара} many {{count} товаров} other {{count} товара}}",
    );
  });

  it("folds literal text around the variable in the format key into every branch", () => {
    const r = appleStringsdict.parse(FIXTURE);
    expect(r.keys["inbox.unread"]?.values["en"]).toBe(
      "{count, plural, one {You have {count} unread message.} other {You have {count} unread messages.}}",
    );
    expect(r.keys["inbox.unread"]?.values["ru"]).toBe(
      "{count, plural, one {У вас {count} непрочитанное сообщение.} few {У вас {count} непрочитанных сообщения.} many {У вас {count} непрочитанных сообщений.} other {У вас {count} непрочитанного сообщения.}}",
    );
  });

  it("decodes XML entities in form bodies", () => {
    const r = appleStringsdict.parse(FIXTURE);
    expect(r.keys["promo.deals"]?.values["en"]).toBe(
      "{count, plural, one {{count} deal & more <3} other {{count} deals & more <3}}",
    );
  });

  it("filters locales when opts.locales is given", () => {
    const r = appleStringsdict.parse(FIXTURE, { locales: ["en"] });
    expect(r.locales).toEqual(["en"]);
    expect(r.keys["cart.items"]?.values["ru"]).toBeUndefined();
  });

  it("warns per file on a malformed plist and keeps parsing other locales", () => {
    const root = mkdtempSync(join(tmpdir(), "glotfile-stringsdict-"));
    mkdirSync(join(root, "en.lproj"));
    mkdirSync(join(root, "fr.lproj"));
    writeFileSync(join(root, "en.lproj", "Localizable.stringsdict"), "<plist><dict><key>oops");
    writeFileSync(
      join(root, "fr.lproj", "Localizable.stringsdict"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>` +
        `<key>k</key><dict><key>NSStringLocalizedFormatKey</key><string>%#@n@</string>` +
        `<key>n</key><dict><key>NSStringFormatSpecTypeKey</key><string>NSStringPluralRuleType</string>` +
        `<key>one</key><string>%d jour</string><key>other</key><string>%d jours</string></dict></dict>` +
        `</dict></plist>`,
    );
    const r = appleStringsdict.parse(root);
    expect(r.locales.sort()).toEqual(["en", "fr"]);
    expect(r.warnings.some((w) => w.includes("failed to parse") && w.includes("en.lproj"))).toBe(true);
    expect(r.keys["k"]?.values["fr"]).toBe("{n, plural, one {{n} jour} other {{n} jours}}");
  });

  it("skips entries it cannot represent, with a warning each", () => {
    const root = mkdtempSync(join(tmpdir(), "glotfile-stringsdict-"));
    mkdirSync(join(root, "en.lproj"));
    writeFileSync(
      join(root, "en.lproj", "Localizable.stringsdict"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>` +
        // Two variables — not representable as a single ICU plural.
        `<key>two.vars</key><dict><key>NSStringLocalizedFormatKey</key><string>%#@a@ in %#@b@</string></dict>` +
        // Missing the required "other" form.
        `<key>no.other</key><dict><key>NSStringLocalizedFormatKey</key><string>%#@n@</string>` +
        `<key>n</key><dict><key>one</key><string>%d</string></dict></dict>` +
        `</dict></plist>`,
    );
    const r = appleStringsdict.parse(root);
    expect(r.keys).toEqual({});
    expect(r.warnings.some((w) => w.includes('"two.vars"') && w.includes("variables"))).toBe(true);
    expect(r.warnings.some((w) => w.includes('"no.other"') && w.includes('"other"'))).toBe(true);
  });
});

describe("appleStringsdict round-trip with the export adapter", () => {
  it("export → parse reproduces the original plural forms", () => {
    const s = defaultState();
    s.config.locales = ["en", "pl"];
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    setPluralForms(s, "cart.items", "pl", {
      one: "{count} produkt",
      few: "{count} produkty",
      many: "{count} produktów",
      other: "{count} produktu",
    });
    createKey(s, "files.escaped", "{n} <files> & dirs", undefined, { plural: { arg: "n" } });

    const exported = appleStringsdictAdapter.export(s, {
      adapter: "apple-stringsdict",
      path: "{locale}.lproj/Localizable.stringsdict",
    });
    const root = mkdtempSync(join(tmpdir(), "glotfile-stringsdict-rt-"));
    for (const f of exported.files) {
      mkdirSync(join(root, dirname(f.path)), { recursive: true });
      writeFileSync(join(root, f.path), f.contents);
    }

    const r = appleStringsdict.parse(root);
    expect(r.warnings).toEqual([]);
    expect(r.locales.sort()).toEqual(["en", "pl"]);
    for (const [key, locale] of [
      ["cart.items", "en"],
      ["cart.items", "pl"],
      ["files.escaped", "en"],
    ] as const) {
      const parsed = parseIcuPlural(r.keys[key]!.values[locale]!);
      expect(parsed?.arg).toBe(s.keys[key]!.plural!.arg);
      expect(parsed?.forms).toEqual(s.keys[key]!.values[locale]!.forms);
    }
  });

  it("round-trips a literal brace span and a literal % through export/import", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "promo", "'{site}': {count} off (50%)", undefined, { plural: { arg: "count" } });
    s.keys["promo"]!.values.en!.forms = {
      one: "'{site}': {count} off (50%)",
      other: "'{site}': {count} off (50%)",
    };

    const exported = appleStringsdictAdapter.export(s, {
      adapter: "apple-stringsdict",
      path: "{locale}.lproj/Localizable.stringsdict",
    });
    const root = mkdtempSync(join(tmpdir(), "glotfile-stringsdict-lit-"));
    for (const f of exported.files) {
      mkdirSync(join(root, dirname(f.path)), { recursive: true });
      writeFileSync(join(root, f.path), f.contents);
    }

    const r = appleStringsdict.parse(root);
    expect(r.warnings).toEqual([]);
    // %d returns to the count token and %% to a literal %; the literal {site}
    // comes back as plain text (stringsdict never interpreted the braces).
    expect(parseIcuPlural(r.keys["promo"]!.values["en"]!)).toEqual({
      arg: "count",
      forms: {
        one: "{site}: {count} off (50%)",
        other: "{site}: {count} off (50%)",
      },
    });
  });
});
