import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { i18nextJson } from "./i18next-json.js";
import { i18nextJson as adapter } from "../../adapters/i18next-json.js";
import { parseIcuPlural } from "../../plurals.js";
import { defaultState } from "../../schema.js";
import { createKey, setTargetValue, setPluralForms } from "../../state.js";

const FLAT = resolve("test/fixtures/import/i18next-json/flat");
const NAMESPACED = resolve("test/fixtures/import/i18next-json/namespaced");

describe("i18nextJson parser (flat layout)", () => {
  it("parses all locale files and flattens nested keys", () => {
    const r = i18nextJson.parse(FLAT);
    expect(r.locales.sort()).toEqual(["de", "en"]);
    expect(r.keys["auth.signIn"]?.values).toEqual({
      en: "Sign in {name}",
      de: "Anmelden {name}",
    });
    expect(r.keys["auth.title"]?.values).toEqual({ en: "Welcome" });
  });

  it("reassembles plural suffix families into one ICU plural string", () => {
    const r = i18nextJson.parse(FLAT);
    expect(r.keys["items"]?.values["en"]).toBe(
      "{count, plural, one {{count} item} other {{count} items}}",
    );
    expect(r.keys["items"]?.values["de"]).toBe(
      "{count, plural, one {{count} Artikel} other {{count} Artikel}}",
    );
    expect(r.keys["items_one"]).toBeUndefined();
    expect(r.keys["items_other"]).toBeUndefined();
  });

  it("emits zero/one/other forms in canonical category order", () => {
    const r = i18nextJson.parse(FLAT);
    expect(r.keys["files"]?.values["en"]).toBe(
      "{count, plural, zero {no files} one {one file} other {{count} files}}",
    );
  });

  it("treats a _one suffix without _other as a literal key", () => {
    const r = i18nextJson.parse(FLAT);
    expect(r.keys["legacy_one"]?.values["en"]).toBe("not a plural");
    expect(r.keys["legacy"]).toBeUndefined();
  });

  it("skips empty-string values so the locale stays missing", () => {
    const r = i18nextJson.parse(FLAT);
    expect(r.keys["empty"]).toBeUndefined();
    expect(r.keys["greeting"]?.values).toEqual({ en: "Hello" });
  });

  it("warns on non-string non-object values", () => {
    const r = i18nextJson.parse(FLAT);
    expect(r.warnings.some((w) => w.includes("en.json") && w.includes('"bad"'))).toBe(true);
    expect(r.keys["bad"]).toBeUndefined();
  });

  it("filters locales when opts.locales is given", () => {
    const r = i18nextJson.parse(FLAT, { locales: ["en"] });
    expect(r.locales).toEqual(["en"]);
    expect(r.keys["auth.signIn"]?.values["de"]).toBeUndefined();
  });
});

describe("i18nextJson parser (namespace layout)", () => {
  it("imports the default namespace unprefixed and others prefixed", () => {
    const r = i18nextJson.parse(NAMESPACED);
    expect(r.locales.sort()).toEqual(["de", "en"]);
    expect(r.keys["home"]?.values).toEqual({ en: "Home {user}", de: "Start {user}" });
    expect(r.keys["common.buttons.save"]?.values).toEqual({ en: "Save", de: "Speichern" });
    expect(r.warnings).toHaveLength(0);
  });

  it("filters locales by directory name", () => {
    const r = i18nextJson.parse(NAMESPACED, { locales: ["de"] });
    expect(r.locales).toEqual(["de"]);
    expect(r.keys["home"]?.values["en"]).toBeUndefined();
  });
});

describe("i18nextJson parser (errors)", () => {
  it("warns on unparseable JSON and keeps going", () => {
    const dir = mkdtempSync(join(tmpdir(), "glotfile-i18next-"));
    try {
      writeFileSync(join(dir, "en.json"), "{ not json", "utf8");
      writeFileSync(join(dir, "de.json"), JSON.stringify({ a: "b" }), "utf8");
      const r = i18nextJson.parse(dir);
      expect(r.locales).toEqual(["de"]);
      expect(r.keys["a"]?.values["de"]).toBe("b");
      expect(r.warnings.some((w) => w.includes("failed to parse en.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("i18nextJson round-trip with the export adapter", () => {
  function fixture() {
    const s = defaultState();
    s.config.locales = ["en", "pl"];
    createKey(s, "auth.signIn", "Sign in {name}");
    setTargetValue(s, "auth.signIn", "pl", "Zaloguj {name}");
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    setPluralForms(s, "cart.items", "pl", {
      one: "{count} produkt",
      few: "{count} produkty",
      many: "{count} produktów",
      other: "{count} produktu",
    });
    return s;
  }

  it("export -> parse recovers values and plural forms", () => {
    const s = fixture();
    const exported = adapter.export(s, {
      adapter: "i18next-json",
      path: "public/locales/{locale}/translation.json",
    });
    const dir = mkdtempSync(join(tmpdir(), "glotfile-i18next-rt-"));
    try {
      for (const f of exported.files) {
        const abs = join(dir, f.path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, f.contents, "utf8");
      }
      const r = i18nextJson.parse(join(dir, "public", "locales"));
      expect(r.locales.sort()).toEqual(["en", "pl"]);
      expect(r.keys["auth.signIn"]?.values).toEqual({
        en: "Sign in {name}",
        pl: "Zaloguj {name}",
      });
      // The synthesized ICU plural must parse back to the exact original forms.
      const en = parseIcuPlural(r.keys["cart.items"]!.values["en"]!);
      expect(en).toEqual({ arg: "count", forms: s.keys["cart.items"]!.values.en!.forms });
      const pl = parseIcuPlural(r.keys["cart.items"]!.values["pl"]!);
      expect(pl).toEqual({ arg: "count", forms: s.keys["cart.items"]!.values.pl!.forms });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
