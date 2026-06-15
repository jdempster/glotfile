import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { railsYaml } from "./rails-yaml.js";
import { railsYaml as railsYamlAdapter } from "../../adapters/rails-yaml.js";
import { defaultState } from "../../schema.js";
import { createKey, setTargetValue, setPluralForms } from "../../state.js";

const FIXTURE = resolve("test/fixtures/import/rails-yaml");

describe("railsYaml parser", () => {
  it("parses nested maps to dotted keys and inverts %{name} placeholders", () => {
    const r = railsYaml.parse(FIXTURE);
    expect(r.keys["auth.sign_in"]?.values["en"]).toBe("Sign in");
    expect(r.keys["auth.sign_in"]?.values["fr"]).toBe("Se connecter");
    expect(r.keys["auth.welcome"]?.values["en"]).toBe("Welcome {name}");
    expect(r.keys["auth.welcome"]?.values["fr"]).toBe("Bienvenue {name}");
  });

  it("derives locales from top-level keys, not filenames", () => {
    const r = railsYaml.parse(FIXTURE);
    expect(r.locales.sort()).toEqual(["de", "en", "es", "fr"]);
    expect(r.keys["greeting"]?.values["de"]).toBe("Hallo");
    expect(r.keys["greeting"]?.values["es"]).toBe("Hola");
  });

  it("handles quoted keys, escapes, plain scalars, single quotes, and comments", () => {
    const r = railsYaml.parse(FIXTURE);
    expect(r.keys["auth.yes"]?.values["en"]).toBe("Yes please");
    expect(r.keys["tricky"]?.values["en"]).toBe('He said "hi" \\ bye\nnext line');
    expect(r.keys["plain"]?.values["en"]).toBe("Hello there");
    expect(r.keys["single"]?.values["en"]).toBe("It's fine");
  });

  it("reassembles CLDR category sub-maps into one ICU plural string", () => {
    const r = railsYaml.parse(FIXTURE);
    expect(r.keys["cart.items"]?.values["en"]).toBe(
      "{count, plural, one {{count} item} other {{count} items}}",
    );
    expect(r.keys["cart.items"]?.values["fr"]).toBe(
      "{count, plural, one {{count} article} other {{count} articles}}",
    );
  });

  it("skips empty-string values so the locale stays missing", () => {
    const r = railsYaml.parse(FIXTURE);
    expect(r.keys["empty"]).toBeUndefined();
  });

  it("filters locales when opts.locales is given", () => {
    const r = railsYaml.parse(FIXTURE, { locales: ["en"] });
    expect(r.locales).toEqual(["en"]);
    expect(r.keys["auth.sign_in"]?.values["fr"]).toBeUndefined();
    expect(r.keys["greeting"]).toBeUndefined();
  });

  it("warns on anchors, block scalars, and sequences without crashing", () => {
    const r = railsYaml.parse(FIXTURE);
    expect(r.warnings.some((w) => w.includes("unsupported.yml") && w.includes("anchors"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("unsupported.yml") && w.includes("block scalars"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("unsupported.yml") && w.includes("sequences"))).toBe(true);
    // Skipped subtrees never surface as keys; siblings still parse.
    expect(r.keys["defaults.nope"]).toBeUndefined();
    expect(r.keys["block"]).toBeUndefined();
    expect(r.keys["ok"]?.values["en"]).toBe("still parsed");
  });

  it("round-trips the export adapter's output", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "auth.signIn.button", "Sign in {name}");
    setTargetValue(s, "auth.signIn.button", "fr", "Se connecter {name}");
    createKey(s, "msg.tricky", 'He said "hi" \\ bye\nline two');
    createKey(s, "msg.yes", "yes");
    createKey(s, "menu.yes", "Yes item");
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    setPluralForms(s, "cart.items", "fr", { one: "{count} article", other: "{count} articles" });

    const exported = railsYamlAdapter.export(s, { adapter: "rails-yaml", path: "config/locales/{locale}.yml" });
    const tmp = mkdtempSync(join(tmpdir(), "glotfile-rails-yaml-"));
    try {
      for (const f of exported.files) {
        const abs = join(tmp, f.path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, f.contents);
      }
      const r = railsYaml.parse(join(tmp, "config", "locales"));
      expect(r.warnings).toEqual([]);
      expect(r.locales.sort()).toEqual(["en", "fr"]);
      expect(r.keys["auth.signIn.button"]?.values["en"]).toBe("Sign in {name}");
      expect(r.keys["auth.signIn.button"]?.values["fr"]).toBe("Se connecter {name}");
      expect(r.keys["msg.tricky"]?.values["en"]).toBe('He said "hi" \\ bye\nline two');
      expect(r.keys["msg.yes"]?.values["en"]).toBe("yes");
      expect(r.keys["menu.yes"]?.values["en"]).toBe("Yes item");
      expect(r.keys["cart.items"]?.values["en"]).toBe(
        "{count, plural, one {{count} item} other {{count} items}}",
      );
      expect(r.keys["cart.items"]?.values["fr"]).toBe(
        "{count, plural, one {{count} article} other {{count} articles}}",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("decodes \\uXXXX / \\xXX unicode escapes in double-quoted scalars", () => {
    const tmp = mkdtempSync(join(tmpdir(), "glotfile-rails-yaml-"));
    try {
      // Real Rails locale files commonly carry \uXXXX escapes; they must decode,
      // not import literally as "u00e9".
      writeFileSync(join(tmp, "en.yml"), 'en:\n  cafe: "Caf\\u00e9 \\xA9"\n');
      const r = railsYaml.parse(tmp);
      expect(r.keys["cafe"]?.values["en"]).toBe("Café ©");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("round-trips bcp47-hyphen locale tokens like pt-BR", () => {
    const s = defaultState();
    s.config.locales = ["en", "pt-br"];
    createKey(s, "welcome", "Welcome");
    setTargetValue(s, "welcome", "pt-br", "Bem-vindo");
    const exported = railsYamlAdapter.export(s, { adapter: "rails-yaml", path: "{locale}.yml" });
    const tmp = mkdtempSync(join(tmpdir(), "glotfile-rails-yaml-"));
    try {
      for (const f of exported.files) writeFileSync(join(tmp, f.path), f.contents);
      const r = railsYaml.parse(tmp);
      expect(r.locales.sort()).toEqual(["en", "pt-BR"]);
      expect(r.keys["welcome"]?.values["pt-BR"]).toBe("Bem-vindo");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
