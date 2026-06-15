import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { vueI18nJson } from "./vue-i18n-json.js";
import { vueI18nJson as adapter } from "../../adapters/vue-i18n-json.js";
import { defaultState } from "../../schema.js";
import { createKey } from "../../state.js";

const FIXTURE = resolve("test/fixtures/import/vue/src/locale");

describe("vueI18nJson parser", () => {
  it("parses both locale files and flattens keys", () => {
    const result = vueI18nJson.parse(FIXTURE);
    expect(result.locales.sort()).toEqual(["en", "fr"]);
    expect(result.keys["auth.signIn"]?.values["en"]).toBe("Sign in");
    expect(result.keys["auth.signIn"]?.values["fr"]).toBe("Se connecter");
    expect(result.warnings).toHaveLength(0);
  });

  it("filters locales when opts.locales is given", () => {
    const result = vueI18nJson.parse(FIXTURE, { locales: ["en"] });
    expect(result.locales).toEqual(["en"]);
    expect(result.keys["auth.signIn"]?.values["fr"]).toBeUndefined();
  });

  it("parses vue literal interpolation {'...'} back to the canonical apostrophe form", () => {
    const dir = mkdtempSync(join(tmpdir(), "glotfile-vue-lit-"));
    try {
      writeFileSync(join(dir, "en.json"), JSON.stringify({ tour: { line: "Dear {visitor}, see {'{site}'}" } }), "utf8");
      const r = vueI18nJson.parse(dir);
      expect(r.keys["tour.line"]?.values["en"]).toBe("Dear {visitor}, see '{site}'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a value with a real placeholder and a literal through export then parse", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    const original = "Dear {visitor}, see '{site}'";
    createKey(s, "tour.line", original);
    const exported = adapter.export(s, { adapter: "vue-i18n-json", path: "resources/locales/{locale}.json" });
    const dir = mkdtempSync(join(tmpdir(), "glotfile-vue-rt-"));
    try {
      for (const f of exported.files) {
        const abs = join(dir, f.path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, f.contents, "utf8");
      }
      const r = vueI18nJson.parse(join(dir, "resources", "locales"));
      expect(r.keys["tour.line"]?.values["en"]).toBe(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
