import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { angularXliff } from "./angular-xliff.js";
import { angularXliff as angularXliffParser } from "../import/parsers/angular-xliff.js";
import { defaultState } from "../schema.js";
import { createKey, setTargetValue, setPluralForms } from "../state.js";

function fixture() {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  createKey(s, "auth.signIn", "Sign in");
  setTargetValue(s, "auth.signIn", "fr", "Se connecter");
  return s;
}

function contents(r: { files: { path: string; contents: string }[] }, locale: string): string {
  return r.files.find((f) => f.path.includes(locale))!.contents;
}

const OUT = { adapter: "angular-xliff", path: "src/locale/messages.{locale}.xlf" };

describe("angular-xliff", () => {
  it("writes one Angular XLIFF 1.2 file per locale", () => {
    const r = angularXliff.export(fixture(), OUT);
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "src/locale/messages.en.xlf",
      "src/locale/messages.fr.xlf",
    ]);
    const fr = contents(r, "fr");
    expect(fr).toContain('<?xml version="1.0" encoding="UTF-8" ?>');
    expect(fr).toContain('<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">');
    expect(fr).toContain('<file source-language="en" target-language="fr" datatype="plaintext" original="ng2.template">');
    expect(fr.endsWith("</xliff>\n")).toBe(true);
  });

  it("emits trans-units with id, source and target", () => {
    const fr = contents(angularXliff.export(fixture(), OUT), "fr");
    expect(fr).toContain('<trans-unit id="auth.signIn" datatype="html">');
    expect(fr).toContain("<source>Sign in</source>");
    expect(fr).toContain("<target>Se connecter</target>");
  });

  it("renders {name} placeholders as Angular interpolation x-elements, ids assigned by source order", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "greet", "Hello {name}, you have {count} messages");
    // The translation reorders the placeholders; ids must follow source order.
    setTargetValue(s, "greet", "fr", "Vous avez {count} messages, {name}");
    const fr = contents(angularXliff.export(s, OUT), "fr");
    expect(fr).toContain(
      '<source>Hello <x id="INTERPOLATION" equiv-text="{{name}}"/>, you have <x id="INTERPOLATION_1" equiv-text="{{count}}"/> messages</source>',
    );
    expect(fr).toContain(
      '<target>Vous avez <x id="INTERPOLATION_1" equiv-text="{{count}}"/> messages, <x id="INTERPOLATION" equiv-text="{{name}}"/></target>',
    );
  });

  it("renders plural keys as VAR_PLURAL ICU text with x-element interpolations in branches", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    setPluralForms(s, "cart.items", "fr", { one: "{count} article", other: "{count} articles" });
    const fr = contents(angularXliff.export(s, OUT), "fr");
    expect(fr).toContain(
      '<source>{VAR_PLURAL, plural, one {<x id="INTERPOLATION" equiv-text="{{count}}"/> item} other {<x id="INTERPOLATION" equiv-text="{{count}}"/> items}}</source>',
    );
    expect(fr).toContain(
      '<target>{VAR_PLURAL, plural, one {<x id="INTERPOLATION" equiv-text="{{count}}"/> article} other {<x id="INTERPOLATION" equiv-text="{{count}}"/> articles}}</target>',
    );
  });

  it("renames the argument of embedded ICU select values to VAR_SELECT", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "pronoun", "{gender, select, male {He} female {She} other {They}}");
    setTargetValue(s, "pronoun", "fr", "{gender, select, male {Il} female {Elle} other {Iel}}");
    const fr = contents(angularXliff.export(s, OUT), "fr");
    expect(fr).toContain("<source>{VAR_SELECT, select, male {He} female {She} other {They}}</source>");
    expect(fr).toContain("<target>{VAR_SELECT, select, male {Il} female {Elle} other {Iel}}</target>");
  });

  it("emits the key description as a note", () => {
    const s = fixture();
    s.keys["auth.signIn"]!.description = "Sign-in button label";
    const fr = contents(angularXliff.export(s, OUT), "fr");
    expect(fr).toContain('<note priority="1" from="description">Sign-in button label</note>');
  });

  it("falls back to the source value for untranslated keys by default and omits them with emptyAs: omit", () => {
    const s = fixture();
    createKey(s, "untranslated", "Pending");
    const fr = contents(angularXliff.export(s, OUT), "fr");
    expect(fr).toContain("<source>Pending</source>");
    expect(fr).toContain('<target state="new">Pending</target>');
    const omitted = contents(angularXliff.export(s, { ...OUT, emptyAs: "omit" }), "fr");
    expect(omitted).not.toContain('id="untranslated"');
  });

  it("escapes XML special characters in text and attributes", () => {
    const s = defaultState();
    createKey(s, "amp", "Fish & <chips>");
    const r = angularXliff.export(s, OUT);
    expect(r.files[0]!.contents).toContain("<source>Fish &amp; &lt;chips&gt;</source>");
  });

  it("renders locale tokens as BCP-47 hyphen by default and honours localeCase", () => {
    const s = defaultState();
    s.config.locales = ["en", "pt-br"];
    createKey(s, "greeting", "Hello");
    const r = angularXliff.export(s, OUT);
    expect(r.files.map((f) => f.path)).toContain("src/locale/messages.pt-BR.xlf");
    expect(contents(r, "pt-BR")).toContain('target-language="pt-BR"');
    const lower = angularXliff.export(s, { ...OUT, localeCase: "lower-underscore" });
    expect(lower.files.map((f) => f.path)).toContain("src/locale/messages.pt_br.xlf");
  });

  it("sorts trans-units by key", () => {
    const s = defaultState();
    createKey(s, "zebra", "Z");
    createKey(s, "apple", "A");
    const en = angularXliff.export(s, OUT).files[0]!.contents;
    expect(en.indexOf('id="apple"')).toBeLessThan(en.indexOf('id="zebra"'));
  });

  it("marks emptyAs:source fallback targets state=\"new\" so re-import won't keep them", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "translated", "Done");
    setTargetValue(s, "translated", "fr", "Fini");
    createKey(s, "pending", "Not yet");
    const fr = contents(angularXliff.export(s, OUT), "fr");
    expect(fr).toContain("<target>Fini</target>");
    expect(fr).toContain('<target state="new">Not yet</target>');
  });

  it("skips the source locale file when skipSourceLocale is set", () => {
    const r = angularXliff.export(fixture(), { ...OUT, skipSourceLocale: true });
    expect(r.files.map((f) => f.path)).toEqual(["src/locale/messages.fr.xlf"]);
  });

  it("re-emits Angular <x/> elements from imported placeholder metadata", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "bold", "{START_TAG_STRONG}Bold{CLOSE_TAG_STRONG} move & more");
    s.keys["bold"]!.placeholders = {
      START_TAG_STRONG: { type: "x-strong", example: "<strong>" },
      CLOSE_TAG_STRONG: { type: "x-strong", example: "</strong>" },
    };
    setTargetValue(s, "bold", "fr", "Coup {START_TAG_STRONG}audacieux{CLOSE_TAG_STRONG}");
    const fr = contents(angularXliff.export(s, OUT), "fr");
    expect(fr).toContain(
      '<source><x id="START_TAG_STRONG" ctype="x-strong" equiv-text="&lt;strong&gt;"/>Bold<x id="CLOSE_TAG_STRONG" ctype="x-strong" equiv-text="&lt;/strong&gt;"/> move &amp; more</source>',
    );
    expect(fr).toContain(
      '<target>Coup <x id="START_TAG_STRONG" ctype="x-strong" equiv-text="&lt;strong&gt;"/>audacieux<x id="CLOSE_TAG_STRONG" ctype="x-strong" equiv-text="&lt;/strong&gt;"/></target>',
    );
  });

  it("emits a bare <x/> for metadata-only tokens and leaves lowercase tokens alone", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "mixed", "Count: {PH} for {name}");
    s.keys["mixed"]!.placeholders = { PH: {}, name: { type: "String" } };
    setTargetValue(s, "mixed", "fr", "Total : {PH} pour {name}");
    const fr = contents(angularXliff.export(s, OUT), "fr");
    // PH (uppercase, imported from Angular) keeps its id; name (ARB-style meta)
    // still goes through the INTERPOLATION convention.
    expect(fr).toContain('<source>Count: <x id="PH"/> for <x id="INTERPOLATION" equiv-text="{{name}}"/></source>');
  });

  it("re-emits a lowercase named $localize placeholder (origin:'x') with its own id", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "addBtn", "Add {displayName}");
    // A user-named $localize placeholder (`${only.displayName}:displayName:`):
    // lowercase id, no ctype, expression kept as the example. origin:"x" marks it
    // as an Angular <x/> element so export reproduces its id instead of falling
    // back to the generic INTERPOLATION convention (which would break the build).
    s.keys["addBtn"]!.placeholders = { displayName: { origin: "x", example: "only.displayName" } };
    setTargetValue(s, "addBtn", "fr", "Ajouter {displayName}");
    const fr = contents(angularXliff.export(s, OUT), "fr");
    expect(fr).toContain('<source>Add <x id="displayName" equiv-text="only.displayName"/></source>');
    expect(fr).toContain('<target>Ajouter <x id="displayName" equiv-text="only.displayName"/></target>');
  });

  it("renders an ICU-apostrophe literal as plain text, only the real placeholder as an x-element", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "literal", "Dear {gardener}, see '{site}'");
    setTargetValue(s, "literal", "fr", "Cher {gardener}, voir '{site}'");
    const fr = contents(angularXliff.export(s, OUT), "fr");
    // The real {gardener} becomes one <x/>; the literal '{site}' is escaped text,
    // never an interpolation placeholder.
    expect(fr).toContain(
      '<source>Dear <x id="INTERPOLATION" equiv-text="{{gardener}}"/>, see \'{site}\'</source>',
    );
    expect(fr).toContain(
      '<target>Cher <x id="INTERPOLATION" equiv-text="{{gardener}}"/>, voir \'{site}\'</target>',
    );
    // Exactly one <x/> in each of source and target — the literal added none.
    expect((fr.match(/<source>[\s\S]*?<\/source>/)![0].match(/<x /g) || []).length).toBe(1);
  });

  it("round-trips an ICU-apostrophe literal (import(export(x)) === x)", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    const en = "Dear {gardener}, see '{site}'";
    const frVal = "Cher {gardener}, voir '{site}'";
    createKey(s, "literal", en);
    setTargetValue(s, "literal", "fr", frVal);
    const r = angularXliff.export(s, OUT);
    const dir = mkdtempSync(join(tmpdir(), "glotfile-xliff-lit-"));
    writeFileSync(join(dir, "messages.xlf"), contents(r, "messages.en.xlf"));
    writeFileSync(join(dir, "messages.fr.xlf"), contents(r, "messages.fr.xlf"));
    const parsed = angularXliffParser.parse(dir);
    expect(parsed.keys["literal"]!.values["en"]).toBe(en);
    expect(parsed.keys["literal"]!.values["fr"]).toBe(frVal);
  });
});
