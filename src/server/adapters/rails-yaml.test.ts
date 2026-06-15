import { describe, it, expect } from "vitest";
import { railsYaml } from "./rails-yaml.js";
import { defaultState } from "../schema.js";
import { createKey, setPluralForms } from "../state.js";

const OUT = { adapter: "rails-yaml", path: "config/locales/{locale}.yml" };

function fixture() {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  createKey(s, "auth.signIn.button", "Sign in {name}");
  s.keys["auth.signIn.button"]!.values.fr = { value: "Se connecter {name}", state: "reviewed" };
  createKey(s, "auth.logout", "Log out");
  createKey(s, "welcome", "Welcome");
  return s;
}

describe("rails-yaml", () => {
  it("writes one file per locale rooted at the locale token, nesting dotted keys", () => {
    const r = railsYaml.export(fixture(), OUT);
    const fr = r.files.find((f) => f.path === "config/locales/fr.yml")!;
    expect(fr.contents).toBe(
      [
        "fr:",
        "  auth:",
        "    signIn:",
        '      button: "Se connecter %{name}"',
        "",
      ].join("\n"),
    );
    const en = r.files.find((f) => f.path === "config/locales/en.yml")!;
    expect(en.contents).toContain('  welcome: "Welcome"');
    expect(en.contents).toContain('    logout: "Log out"');
  });

  it("omits untranslated keys by default and fills from source with emptyAs source", () => {
    const omit = railsYaml.export(fixture(), OUT);
    expect(omit.files.find((f) => f.path === "config/locales/fr.yml")!.contents).not.toContain("logout");
    const fill = railsYaml.export(fixture(), { ...OUT, emptyAs: "source" });
    expect(fill.files.find((f) => f.path === "config/locales/fr.yml")!.contents).toContain('    logout: "Log out"');
  });

  it("writes plural entries as CLDR category subkeys", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    setPluralForms(s, "cart.items", "fr", { one: "{count} article", other: "{count} articles" });
    const r = railsYaml.export(s, OUT);
    const en = r.files.find((f) => f.path === "config/locales/en.yml")!;
    expect(en.contents).toContain("  cart:");
    expect(en.contents).toContain("    items:");
    expect(en.contents).toContain('      one: "%{count} item"');
    expect(en.contents).toContain('      other: "%{count} items"');
    expect(r.warnings.some((w) => w.key === "cart.items")).toBe(false);
  });

  it("warns (structured) on inline ICU and writes it through unconverted", () => {
    const s = defaultState();
    createKey(s, "items.count", "{count, plural, one {# item} other {# items}}");
    const r = railsYaml.export(s, OUT);
    expect(r.warnings.some((w) => w.key === "items.count" && w.code === "lossy-plural")).toBe(true);
    expect(r.files[0]!.contents).toContain("plural,");
  });

  it("always double-quotes values, escaping quotes, backslashes, and newlines", () => {
    const s = defaultState();
    createKey(s, "msg.tricky", 'He said "hi" \\ bye');
    createKey(s, "msg.multiline", "line one\nline two");
    createKey(s, "msg.yes", "yes");
    createKey(s, "msg.percent", "%{name} leads");
    const r = railsYaml.export(s, OUT);
    const en = r.files[0]!.contents;
    expect(en).toContain('    tricky: "He said \\"hi\\" \\\\ bye"');
    expect(en).toContain('    multiline: "line one\\nline two"');
    expect(en).toContain('    "yes": "yes"');
    expect(en).toContain('    percent: "%{name} leads"');
  });

  it("quotes YAML-reserved and non-identifier keys", () => {
    const s = defaultState();
    s.config.locales = ["no"];
    s.config.sourceLocale = "no";
    createKey(s, "menu.yes", "Ja");
    createKey(s, "menu.1", "En");
    const r = railsYaml.export(s, OUT);
    const no = r.files.find((f) => f.path === "config/locales/no.yml")!;
    expect(no.contents.startsWith('"no":')).toBe(true);
    expect(no.contents).toContain('    "yes": "Ja"');
    expect(no.contents).toContain('    "1": "En"');
  });

  it("renders locale tokens in Rails bcp47-hyphen form by default", () => {
    const s = defaultState();
    s.config.locales = ["en", "pt-br"];
    createKey(s, "welcome", "Welcome");
    s.keys["welcome"]!.values["pt-br"] = { value: "Bem-vindo", state: "reviewed" };
    const r = railsYaml.export(s, OUT);
    const pt = r.files.find((f) => f.path === "config/locales/pt-BR.yml")!;
    expect(pt.contents.startsWith("pt-BR:")).toBe(true);
    expect(pt.contents).toContain('  welcome: "Bem-vindo"');
  });

  it("warns on key collisions (leaf and parent) and drops the leaf", () => {
    const s = defaultState();
    createKey(s, "auth", "Auth");
    createKey(s, "auth.title", "Title");
    const r = railsYaml.export(s, OUT);
    expect(r.warnings.some((w) => w.code === "key-collision")).toBe(true);
  });

  it("warns on locale collisions", () => {
    const s = defaultState();
    s.config.locales = ["en", "pt-br"];
    createKey(s, "welcome", "Welcome");
    const r = railsYaml.export(s, { ...OUT, localeMap: { "pt-br": "en" } });
    expect(r.warnings.some((w) => w.code === "locale-collision")).toBe(true);
  });

  it("honours indent and finalNewline overrides", () => {
    const s = defaultState();
    createKey(s, "a.b", "v");
    const r = railsYaml.export(s, { ...OUT, indent: 4, finalNewline: false });
    expect(r.files[0]!.contents).toBe('en:\n    a:\n        b: "v"');
  });

  it("emits just the root key line for a locale with no exportable keys", () => {
    const r = railsYaml.export(defaultState(), OUT);
    expect(r.files[0]!.contents).toBe("en:\n");
  });

  it("re-export is byte-identical", () => {
    const a = railsYaml.export(fixture(), OUT);
    const b = railsYaml.export(fixture(), OUT);
    expect(b.files).toEqual(a.files);
  });
});
