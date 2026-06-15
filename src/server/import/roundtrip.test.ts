import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runImport } from "./run.js";
import { flutterArb } from "../adapters/flutter-arb.js";
import { appleStrings } from "../adapters/apple-strings.js";
import { angularXliff } from "../adapters/angular-xliff.js";
import { railsYaml } from "../adapters/rails-yaml.js";
import { i18nextJson } from "../adapters/i18next-json.js";
import { gettextPo } from "../adapters/gettext-po.js";
import { appleStringsdict } from "../adapters/apple-stringsdict.js";

const ROOT = resolve("test/fixtures/import/arb-plural");
const APPLE_ROOT = resolve("test/fixtures/import/apple");
const ANGULAR_ROOT = resolve("test/fixtures/import/angular-xliff");

// End-to-end proof for the user's requirement: a Flutter project whose plurals use
// exact `=N` selectors (the kiosk case) imports into glotfile's structured plural
// format AND re-exports to valid ICU. The import units are TDD'd individually in
// assemble.test.ts / plurals.test.ts; this composes them through the real parser.
describe("flutter-arb import with cldr conversion", () => {
  it("converts the =1 plural to CLDR categories and exports keyword form", () => {
    const { state } = runImport({ projectRoot: ROOT, sourceLocale: "en", cldr: true });
    const entry = state.keys["deliveries_failed"]!;
    expect(entry.plural).toEqual({ arg: "count" });
    // en's =1 became the CLDR `one` category; no exact selector remains.
    expect(entry.values.en!.forms).toEqual({
      one: "Failed to collect delivery",
      other: "Failed to collect deliveries",
    });
    const r = flutterArb.export(state, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents);
    expect(en["deliveries_failed"]).toBe(
      "{count, plural, one {Failed to collect delivery} other {Failed to collect deliveries}}",
    );
  });
});

describe("flutter-arb =N plural round-trip", () => {
  it("imports a =1 plural as a structured plural key", () => {
    const { state } = runImport({ projectRoot: ROOT, sourceLocale: "en" });
    const entry = state.keys["deliveries_failed"]!;
    expect(entry.plural).toEqual({ arg: "count" });
    expect(entry.values.en!.forms).toEqual({
      "=1": "Failed to collect delivery",
      other: "Failed to collect deliveries",
    });
    expect(entry.values.fr!.forms).toEqual({
      "=1": "Échec de la collecte",
      other: "Échecs de la collecte",
    });
    expect(entry.values.en!.value).toBeUndefined();
  });

  it("re-exports the =1 plural as valid ICU with the count placeholder declared", () => {
    const { state } = runImport({ projectRoot: ROOT, sourceLocale: "en" });
    const r = flutterArb.export(state, { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" });
    const en = JSON.parse(r.files.find((f) => f.path.endsWith("app_en.arb"))!.contents);
    // glotfile normalizes whitespace (a space before each "{"), same as it does for
    // keyword categories — semantically identical to the source, valid for gen_l10n.
    expect(en["deliveries_failed"]).toBe(
      "{count, plural, =1 {Failed to collect delivery} other {Failed to collect deliveries}}",
    );
    expect(en["@deliveries_failed"]).toMatchObject({ placeholders: { count: {} } });
    const fr = JSON.parse(r.files.find((f) => f.path.endsWith("app_fr.arb"))!.contents);
    expect(fr["deliveries_failed"]).toBe(
      "{count, plural, =1 {Échec de la collecte} other {Échecs de la collecte}}",
    );
  });
});

describe("apple-strings round-trip", () => {
  it("imports .lproj tables and re-exports them with values intact", () => {
    const { state } = runImport({ projectRoot: APPLE_ROOT, sourceLocale: "en" });
    expect(state.config.locales.sort()).toEqual(["en", "fr", "zh-hans"]);
    // Natural-language source text is the key; quotes/newlines survive unescaping.
    expect(state.keys['Quotes "here"']!.values.en!.value).toBe('Quotes "here"');
    expect(state.keys["Multi line"]!.values.fr!.value).toBe("Ligne un\nLigne deux");

    const r = appleStrings.export(state, state.config.outputs[0]!);
    // zh-hans canonical re-exports to the zh-Hans.lproj dir (inferred bcp47 casing).
    const paths = r.files.map((f) => f.path).sort();
    expect(paths).toContain("zh-Hans.lproj/Localizable.strings");
    const en = r.files.find((f) => f.path === "en.lproj/Localizable.strings")!.contents;
    expect(en).toContain('"Quotes \\"here\\"" = "Quotes \\"here\\"";');
    expect(en).toContain('"Multi line" = "Line one\\nLine two";');
  });
});

// Angular owns messages.xlf (ng extract-i18n regenerates it); glotfile imports it
// plus the messages.<locale>.xlf translations and exports only the latter back.
describe("angular-xliff round-trip", () => {
  it("imports messages.xlf + messages.es.xlf into a state with canonical locales", () => {
    const { state, warnings } = runImport({ projectRoot: ANGULAR_ROOT });
    expect(state.config.sourceLocale).toBe("en-us");
    expect(state.config.locales).toEqual(["en-us", "es"]);
    const out = state.config.outputs[0]!;
    expect(out.adapter).toBe("angular-xliff");
    expect(out.path).toBe("src/locale/messages.{locale}.xlf");
    expect(out.skipSourceLocale).toBe(true);
    expect(state.keys["01d37830d7001a7739c544c7570df79399d1dc31"]!.values["es"]!.value).toBe("Tus aplicaciones");
    expect(warnings.some((w) => w.includes("error"))).toBe(false);
  });

  it("converts a VAR_PLURAL ICU unit into a structured plural key", () => {
    const { state } = runImport({ projectRoot: ANGULAR_ROOT });
    const entry = state.keys["pluralhash000000000000000000000000000000"]!;
    expect(entry.plural).toBeDefined();
    expect(entry.values["en-us"]!.forms).toEqual({
      "=0": "no items",
      one: "one item",
      other: "{count} items",
    });
    expect(entry.values["es"]!.forms!.other).toBe("{count} elementos");
  });

  it("exports only the translation file, reproducing Angular <x/> placeholders", () => {
    const { state } = runImport({ projectRoot: ANGULAR_ROOT });
    const r = angularXliff.export(state, state.config.outputs[0]!);
    // skipSourceLocale: no messages.en-US.xlf — Angular regenerates the source file.
    expect(r.files.map((f) => f.path)).toEqual(["src/locale/messages.es.xlf"]);
    const es = r.files[0]!.contents;
    expect(es).toContain("<target>Tus aplicaciones</target>");
    expect(es).toContain('¡Bienvenido <x id="INTERPOLATION" equiv-text="{{name}}"/>!');
    // Markup placeholders re-emit their original id/ctype/equiv-text.
    expect(es).toContain('<x id="START_TAG_STRONG" ctype="x-strong" equiv-text="&lt;strong&gt;"/>');
    // Entities survive the trip.
    expect(es).toContain("Fish &amp; chips &lt;tasty&gt;");
  });

  // Regression: a user-named $localize placeholder (`${only.displayName}:displayName:`)
  // extracts as <x id="displayName">. Its lowercase id escapes the SCREAMING_SNAKE
  // convention, so import must tag it origin:"x" and export must honour that — else
  // it round-trips to the generic INTERPOLATION id and ng build fails with a
  // placeholder mismatch. Round-trips both halves through the real pipeline.
  it("round-trips a lowercase named placeholder, preserving its <x/> id", () => {
    const root = mkdtempSync(join(tmpdir(), "glotfile-ngx-rt-"));
    const locale = join(root, "src", "locale");
    mkdirSync(locale, { recursive: true });
    writeFileSync(
      join(locale, "messages.xlf"),
      `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en-US" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="addSingleProviderButton" datatype="html">
        <source>Add <x id="displayName" equiv-text="only.displayName"/></source>
      </trans-unit>
    </body>
  </file>
</xliff>`,
    );
    writeFileSync(
      join(locale, "messages.es.xlf"),
      `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en-US" target-language="es" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="addSingleProviderButton" datatype="html">
        <source>Add <x id="displayName" equiv-text="only.displayName"/></source>
        <target>Agregar <x id="displayName" equiv-text="only.displayName"/></target>
      </trans-unit>
    </body>
  </file>
</xliff>`,
    );
    const { state } = runImport({ projectRoot: root });
    const es = angularXliff.export(state, state.config.outputs[0]!).files[0]!.contents;
    expect(es).toContain('<source>Add <x id="displayName" equiv-text="only.displayName"/></source>');
    expect(es).toContain('<target>Agregar <x id="displayName" equiv-text="only.displayName"/></target>');
    expect(es).not.toContain("INTERPOLATION");
  });
});

// Lean composed checks for the remaining importable formats: auto-detect →
// import → re-export through the matching adapter. Deep per-format coverage
// lives in each parser's own test file.
describe("rails-yaml round-trip", () => {
  it("imports config/locales and re-exports plurals as %{count} category maps", () => {
    const { state } = runImport({ projectRoot: resolve("test/fixtures/import/rails-detect") });
    expect(state.config.sourceLocale).toBe("en");
    expect(state.keys["auth.sign_in"]!.values.fr!.value).toBe("Se connecter");
    const entry = state.keys["cart.items"]!;
    expect(entry.plural).toBeDefined();
    expect(entry.values.en!.forms).toEqual({ one: "{count} item", other: "{count} items" });
    const r = railsYaml.export(state, state.config.outputs[0]!);
    const fr = r.files.find((f) => f.path.endsWith("fr.yml"))!.contents;
    expect(fr).toContain('one: "%{count} article"');
    expect(fr).toContain('sign_in: "Se connecter"');
  });
});

describe("i18next-json round-trip", () => {
  it("imports per-locale dirs and re-exports {{name}} interpolations", () => {
    const { state } = runImport({ projectRoot: resolve("test/fixtures/import/i18next-detect") });
    expect(state.keys["home"]!.values.en!.value).toBe("Home {user}");
    const r = i18nextJson.export(state, state.config.outputs[0]!);
    const en = r.files.find((f) => f.path.includes("en"))!.contents;
    expect(en).toContain('"Home {{user}}"');
  });
});

describe("gettext-po round-trip", () => {
  it("imports po files and re-exports plural msgstr indexes", () => {
    const { state } = runImport({ projectRoot: resolve("test/fixtures/import/gettext-po") });
    expect(state.config.sourceLocale).toBe("en");
    expect(state.keys["auth.signIn"]!.values.pl!.value).toBe("Zaloguj");
    const entry = state.keys["cart.items"]!;
    expect(entry.plural).toBeDefined();
    // pl has more CLDR categories than en; all three forms survive.
    expect(Object.keys(entry.values.pl!.forms!).length).toBeGreaterThanOrEqual(3);
    const r = gettextPo.export(state, state.config.outputs[0]!);
    const pl = r.files.find((f) => f.path.includes("pl"))!.contents;
    expect(pl).toContain('msgstr[0] "%d produkt"');
  });
});

describe("apple-stringsdict round-trip", () => {
  it("imports .stringsdict plurals and re-exports the plist structure", () => {
    const { state } = runImport({ projectRoot: resolve("test/fixtures/import/apple-stringsdict") });
    const entry = state.keys["cart.items"]!;
    expect(entry.plural).toEqual({ arg: "count" });
    expect(entry.values.en!.forms).toEqual({ one: "{count} item", other: "{count} items" });
    const r = appleStringsdict.export(state, state.config.outputs[0]!);
    const en = r.files.find((f) => f.path.includes("en.lproj"))!.contents;
    expect(en).toContain("<key>NSStringLocalizedFormatKey</key>");
    expect(en).toContain("<string>%d items</string>");
  });
});
