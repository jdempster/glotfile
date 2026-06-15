import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultState } from "./schema.js";
import { createKey, setTargetValue, removeLocale } from "./state.js";
import { exportToDisk, effectiveLocales, narrowForExport } from "./export-run.js";
import { existsSync } from "node:fs";

function project() {
  const dir = mkdtempSync(join(tmpdir(), "glot-exp-"));
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  s.config.outputs = [{ adapter: "vue-i18n-json", path: "locales/{locale}.json" }];
  createKey(s, "a.b", "Hi");
  return { dir, s };
}

describe("exportToDisk", () => {
  it("writes files, then skips unchanged ones on re-run (changed-files-only)", () => {
    const { dir, s } = project();
    const first = exportToDisk(s, dir);
    expect(first.written).toBe(2);
    expect(first.skipped).toBe(0);
    expect(readFileSync(join(dir, "locales/en.json"), "utf8")).toContain('"a"');

    const second = exportToDisk(s, dir);
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it("rewrites only the file whose content changed", () => {
    const { dir, s } = project();
    exportToDisk(s, dir);
    writeFileSync(join(dir, "locales/fr.json"), "stale", "utf8");
    const r = exportToDisk(s, dir);
    expect(r.written).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it("honours config.exportLocales — writes only the limited locales", () => {
    const { dir, s } = project();
    s.config.exportLocales = ["en"];
    const r = exportToDisk(s, dir);
    expect(r.written).toBe(1);
    expect(existsSync(join(dir, "locales/en.json"))).toBe(true);
    expect(existsSync(join(dir, "locales/fr.json"))).toBe(false);
  });

  it("on a locale collision writes the first locale (config order), skipping the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-exp-"));
    const s = defaultState();
    // localeMap collapses both zh variants onto the same "zh" token; config.locales
    // order (en, zh-hant, zh-hans after normalization) makes zh-hant the first writer.
    s.config.locales = ["en", "zh-hant", "zh-hans"];
    s.config.outputs = [
      {
        adapter: "flutter-arb",
        path: "lib/l10n/app_{locale}.arb",
        localeMap: { "zh-hant": "zh", "zh-hans": "zh" },
      },
    ];
    createKey(s, "greeting", "Hello");
    setTargetValue(s, "greeting", "zh-hant", "HANT");
    setTargetValue(s, "greeting", "zh-hans", "HANS");

    const r = exportToDisk(s, dir);

    expect(r.warnings.some((w) => w.code === "locale-collision")).toBe(true);

    const contents = readFileSync(join(dir, "lib/l10n/app_zh.arb"), "utf8");
    const obj = JSON.parse(contents);
    // zh-hant is first in config order, so its value wins on disk.
    expect(obj["@@locale"]).toBe("zh");
    expect(obj.greeting).toBe("HANT");
    expect(contents).not.toContain("HANS");
  });
});

describe("exportToDisk pruning of removed locales", () => {
  it("deletes the exported file of a locale that was removed", () => {
    const { dir, s } = project();
    exportToDisk(s, dir);
    expect(existsSync(join(dir, "locales/fr.json"))).toBe(true);

    removeLocale(s, "fr");
    const r = exportToDisk(s, dir);
    expect(r.deleted).toBe(1);
    expect(existsSync(join(dir, "locales/fr.json"))).toBe(false);
    expect(existsSync(join(dir, "locales/en.json"))).toBe(true);
  });

  it("does not delete files for locales excluded only by config.exportLocales", () => {
    const { dir, s } = project();
    exportToDisk(s, dir);
    s.config.exportLocales = ["en"];
    const r = exportToDisk(s, dir);
    expect(r.deleted).toBe(0);
    expect(existsSync(join(dir, "locales/fr.json"))).toBe(true);
  });

  it("leaves template-shaped files whose token doesn't look like a locale", () => {
    const { dir, s } = project();
    exportToDisk(s, dir);
    writeFileSync(join(dir, "locales/index.json"), "{}", "utf8");
    const r = exportToDisk(s, dir);
    expect(r.deleted).toBe(0);
    expect(existsSync(join(dir, "locales/index.json"))).toBe(true);
  });

  it("prunes a removed locale's directory tree for {locale}-dir templates", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-exp-"));
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    s.config.outputs = [{ adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" }];
    createKey(s, "messages.hi", "Hi");
    setTargetValue(s, "messages.hi", "fr", "Salut");
    exportToDisk(s, dir);
    expect(existsSync(join(dir, "lang/fr/messages.php"))).toBe(true);

    removeLocale(s, "fr");
    const r = exportToDisk(s, dir);
    expect(r.deleted).toBe(1);
    expect(existsSync(join(dir, "lang/fr/messages.php"))).toBe(false);
    // the now-empty fr/ directory is cleaned up too
    expect(existsSync(join(dir, "lang/fr"))).toBe(false);
    expect(existsSync(join(dir, "lang/en/messages.php"))).toBe(true);
  });

  it("keeps a stale token's file when localeMap still maps a current locale onto it", () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-exp-"));
    const s = defaultState();
    s.config.locales = ["en", "zh-hant"];
    s.config.outputs = [
      { adapter: "vue-i18n-json", path: "locales/{locale}.json", localeMap: { "zh-hant": "zh" } },
    ];
    createKey(s, "a", "Hi");
    exportToDisk(s, dir);
    const r = exportToDisk(s, dir);
    expect(r.deleted).toBe(0);
    expect(existsSync(join(dir, "locales/zh.json"))).toBe(true);
  });
});

describe("effectiveLocales / narrowForExport", () => {
  function cfg() {
    const s = defaultState();
    s.config.locales = ["en", "fr", "de"];
    return s;
  }

  it("returns all locales when no limit is set", () => {
    expect(effectiveLocales(cfg().config)).toEqual(["en", "fr", "de"]);
  });

  it("intersects the limit with project locales (order = project order, stale entries dropped)", () => {
    const s = cfg();
    s.config.exportLocales = ["de", "en", "es"];
    expect(effectiveLocales(s.config)).toEqual(["en", "de"]);
  });

  it("narrowForExport returns the same object when nothing is narrowed", () => {
    const s = cfg();
    expect(narrowForExport(s)).toBe(s);
  });

  it("narrowForExport produces a narrowed clone without mutating the original", () => {
    const s = cfg();
    s.config.exportLocales = ["fr"];
    const narrowed = narrowForExport(s);
    expect(narrowed.config.locales).toEqual(["fr"]);
    expect(s.config.locales).toEqual(["en", "fr", "de"]);
  });
});
