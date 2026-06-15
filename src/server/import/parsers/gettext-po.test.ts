import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { gettextPo } from "./gettext-po.js";
import { gettextPo as adapter } from "../../adapters/gettext-po.js";
import { defaultState } from "../../schema.js";
import { createKey, setTargetValue, setPluralForms } from "../../state.js";
import { parseIcuPlural } from "../../plurals.js";

const FIXTURE = resolve("test/fixtures/import/gettext-po/po");
const HEADER_FIXTURE = resolve("test/fixtures/import/gettext-po/header");

describe("gettextPo parser", () => {
  it("parses flat <locale>.po files and skips the header entry", () => {
    const result = gettextPo.parse(FIXTURE);
    expect(result.locales.sort()).toEqual(["en", "pl"]);
    expect(result.keys["auth.signIn"]?.values).toEqual({ en: "Sign in", pl: "Zaloguj" });
    // The header (empty msgid) must not become a key.
    expect(Object.keys(result.keys)).not.toContain("");
    expect(result.warnings).toHaveLength(0);
  });

  it("unescapes quotes, backslashes and tabs", () => {
    const result = gettextPo.parse(FIXTURE);
    expect(result.keys["msg.escaped"]?.values["en"]).toBe('Say "hi"\tnow \\ done');
    expect(result.keys["msg.escaped"]?.values["pl"]).toBe('Powiedz "cześć"');
  });

  it("concatenates multi-line strings with \\n escapes", () => {
    const result = gettextPo.parse(FIXTURE);
    expect(result.keys["msg.multiline"]?.values["en"]).toBe("Line one\nLine two");
    expect(result.keys["msg.multiline"]?.values["pl"]).toBe("Linia jeden\nLinia dwa");
  });

  it("maps plural msgstr[N] back to ICU plural strings with the count arg", () => {
    const result = gettextPo.parse(FIXTURE);
    expect(result.keys["cart.items"]?.values["en"]).toBe(
      "{count, plural, one {{count} item} other {{count} items}}",
    );
    expect(result.keys["cart.items"]?.values["pl"]).toBe(
      "{count, plural, one {{count} produkt} few {{count} produkty} many {{count} produktów} other {{count} produktu}}",
    );
  });

  it("skips untranslated entries so the locale stays missing", () => {
    const result = gettextPo.parse(FIXTURE);
    // Scalar with empty msgstr.
    expect(result.keys["only.en"]?.values["en"]).toBe("Pending");
    expect(result.keys["only.en"]?.values["pl"]).toBeUndefined();
    // Plural with all msgstr[N] empty.
    expect(result.keys["cart.empty"]?.values["en"]).toBeDefined();
    expect(result.keys["cart.empty"]?.values["pl"]).toBeUndefined();
  });

  it("filters locales when opts.locales is given", () => {
    const result = gettextPo.parse(FIXTURE, { locales: ["en"] });
    expect(result.locales).toEqual(["en"]);
    expect(result.keys["auth.signIn"]?.values["pl"]).toBeUndefined();
  });

  it("falls back to the Language header when the filename has no locale", () => {
    const result = gettextPo.parse(HEADER_FIXTURE);
    expect(result.locales).toEqual(["de"]);
    // No msgctxt → the msgid is the key.
    expect(result.keys["Hello"]?.values["de"]).toBe("Hallo");
  });

  it("warns and skips a file whose locale cannot be determined", () => {
    const result = gettextPo.parse(HEADER_FIXTURE);
    expect(result.warnings).toEqual(["gettext-po: cannot determine locale for orphan.po; skipped"]);
    expect(result.keys["Orphan"]).toBeUndefined();
  });

  it("round-trips a literal brace span and a literal % through export/import", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "promo", "See '{site}' for 50% off");
    createKey(s, "deal", "{count} off (50%)", undefined, { plural: { arg: "count" } });
    s.keys["deal"]!.values.en!.forms = { one: "{count} off (50%)", other: "{count} off (50%)" };

    const exported = adapter.export(s, { adapter: "gettext-po", path: "locale/{locale}/LC_MESSAGES/messages.po" });
    const tmp = mkdtempSync(join(tmpdir(), "glotfile-po-lit-"));
    try {
      for (const f of exported.files) {
        mkdirSync(dirname(join(tmp, f.path)), { recursive: true });
        writeFileSync(join(tmp, f.path), f.contents);
      }
      const result = gettextPo.parse(join(tmp, "locale"));
      // Scalar literal % survives; the literal {site} comes back as plain text
      // (gettext never interpreted the braces, so no apostrophe markers needed).
      expect(result.keys["promo"]?.values["en"]).toBe("See {site} for 50% off");
      expect(parseIcuPlural(result.keys["deal"]!.values["en"]!)).toEqual({
        arg: "count",
        forms: { one: "{count} off (50%)", other: "{count} off (50%)" },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("round-trips the export adapter's LC_MESSAGES layout", () => {
    const s = defaultState();
    s.config.locales = ["en", "pl"];
    createKey(s, "auth.signIn", "Sign in");
    setTargetValue(s, "auth.signIn", "pl", "Zaloguj");
    createKey(s, "msg.tricky", 'Say "hi"\nline\ttab \\ done');
    setTargetValue(s, "msg.tricky", "pl", 'Powiedz "cześć"');
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values["en"]!.forms = { one: "{count} item", other: "{count} items" };
    setPluralForms(s, "cart.items", "pl", {
      one: "{count} produkt",
      few: "{count} produkty",
      many: "{count} produktów",
      other: "{count} produktu",
    });

    const exported = adapter.export(s, { adapter: "gettext-po", path: "locale/{locale}/LC_MESSAGES/messages.po" });
    const tmp = mkdtempSync(join(tmpdir(), "glotfile-po-"));
    try {
      for (const f of exported.files) {
        mkdirSync(dirname(join(tmp, f.path)), { recursive: true });
        writeFileSync(join(tmp, f.path), f.contents);
      }
      const result = gettextPo.parse(join(tmp, "locale"));
      expect(result.locales.sort()).toEqual(["en", "pl"]);
      expect(result.keys["auth.signIn"]?.values).toEqual({ en: "Sign in", pl: "Zaloguj" });
      expect(result.keys["msg.tricky"]?.values["en"]).toBe('Say "hi"\nline\ttab \\ done');
      expect(result.keys["msg.tricky"]?.values["pl"]).toBe('Powiedz "cześć"');
      // Plural values come back as ICU strings whose forms match the state.
      expect(parseIcuPlural(result.keys["cart.items"]!.values["en"]!)).toEqual({
        arg: "count",
        forms: s.keys["cart.items"]!.values["en"]!.forms,
      });
      expect(parseIcuPlural(result.keys["cart.items"]!.values["pl"]!)).toEqual({
        arg: "count",
        forms: s.keys["cart.items"]!.values["pl"]!.forms,
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
