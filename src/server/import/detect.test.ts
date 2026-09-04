import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { detect } from "./detect.js";

describe("detect", () => {
  it("detects laravel-php from fixture", () => {
    const d = detect(resolve("test/fixtures/import/laravel"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("laravel-php");
    expect(d!.locales.sort()).toEqual(["en", "fr"]);
    expect(d!.sourceLocale).toBe("en");
  });

  it("detects vue-i18n-json from fixture", () => {
    const d = detect(resolve("test/fixtures/import/vue"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("vue-i18n-json");
  });

  it("detects flutter-arb from fixture", () => {
    const d = detect(resolve("test/fixtures/import/arb"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("flutter-arb");
  });

  it("detects apple-strings from .lproj dirs at the root", () => {
    const d = detect(resolve("test/fixtures/import/apple"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("apple-strings");
    expect(d!.locales.sort()).toEqual(["en", "fr", "zh-Hans"]);
    expect(d!.sourceLocale).toBe("en");
  });

  it("detects apple-strings when .lproj dirs sit one level down", () => {
    const d = detect(resolve("test/fixtures/import/apple-nested"));
    expect(d!.format).toBe("apple-strings");
    expect(d!.localeRoot).toMatch(/App$/);
    expect(d!.locales.sort()).toEqual(["en", "fr"]);
  });

  it("returns null for an empty directory", () => {
    const d = detect(resolve("test/fixtures/import/laravel/lang/en"));
    expect(d).toBeNull();
  });

  it("detects vue-i18n-json from a single en locale file", () => {
    const d = detect(resolve("test/fixtures/import/vue-single-en"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("vue-i18n-json");
    expect(d!.locales).toEqual(["en"]);
    expect(d!.sourceLocale).toBe("en");
  });

  it("does not auto-detect vue-i18n-json from a single non-en locale file", () => {
    const d = detect(resolve("test/fixtures/import/vue-single-de"));
    expect(d).toBeNull();
  });

  it("accepts a single non-en locale file with an explicit format override", () => {
    const d = detect(resolve("test/fixtures/import/vue-single-de"), "vue-i18n-json");
    expect(d).not.toBeNull();
    expect(d!.locales).toEqual(["de"]);
    expect(d!.sourceLocale).toBe("de");
  });

  it("respects a format override", () => {
    const d = detect(resolve("test/fixtures/import/laravel"), "laravel-php");
    expect(d!.format).toBe("laravel-php");
  });

  it("detects rails-yaml from config/locales, locales from top-level keys", () => {
    const d = detect(resolve("test/fixtures/import/rails-detect"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("rails-yaml");
    expect(d!.locales.sort()).toEqual(["en", "fr"]);
    expect(d!.sourceLocale).toBe("en");
  });

  it("detects i18next-json from per-locale directories under public/locales", () => {
    const d = detect(resolve("test/fixtures/import/i18next-detect"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("i18next-json");
    expect(d!.locales.sort()).toEqual(["de", "en"]);
    expect(d!.sourceLocale).toBe("en");
  });

  it("detects gettext-po from a po/ dir of <locale>.po files", () => {
    const d = detect(resolve("test/fixtures/import/gettext-po"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("gettext-po");
    expect(d!.locales.sort()).toEqual(["en", "pl"]);
    expect(d!.sourceLocale).toBe("en");
  });

  it("detects apple-stringsdict only when no .strings tables exist alongside", () => {
    const d = detect(resolve("test/fixtures/import/apple-stringsdict"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("apple-stringsdict");
    expect(d!.locales.sort()).toEqual(["en", "ru"]);
    // A project with both tables auto-detects as apple-strings (it runs first);
    // stringsdict import there needs --format apple-stringsdict.
    const both = detect(resolve("test/fixtures/import/apple"));
    expect(both!.format).toBe("apple-strings");
  });

  it("detects angular-xliff from messages.xlf files in src/locale", () => {
    const d = detect(resolve("test/fixtures/import/angular-xliff"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("angular-xliff");
    expect(d!.localeRoot).toMatch(/src\/locale$/);
    // Source locale comes from the source-language attribute, not a filename.
    expect(d!.sourceLocale).toBe("en-US");
    expect(d!.locales.sort()).toEqual(["en-US", "es"]);
  });

  // `--source` sets the search root, so it is routinely pointed straight at the
  // directory holding the locale files rather than at a project root.
  it("detects a directory that itself holds the locale files", () => {
    const d = detect(resolve("test/fixtures/import/vue/src/locale"));
    expect(d).not.toBeNull();
    expect(d!.format).toBe("vue-i18n-json");
    expect(d!.locales.sort()).toEqual(["en", "fr"]);
    expect(d!.localeRoot).toMatch(/locale$/);
  });

  it("prefers a conventional subdirectory over the search root itself", () => {
    const d = detect(resolve("test/fixtures/import/vue"));
    expect(d!.localeRoot).toBe(resolve("test/fixtures/import/vue/src/locale"));
  });

  describe("split-storage catalogs", () => {
    // config.json + keys.json + locales/<locale>.json holding { value, state }
    // records — glotfile's own storage, not framework locale files.
    function makeCatalog(): string {
      const dir = join(mkdtempSync(join(tmpdir(), "glot-")), "glotfile");
      mkdirSync(join(dir, "locales"), { recursive: true });
      writeFileSync(join(dir, "config.json"), JSON.stringify({ version: 1, config: { sourceLocale: "en-us" } }));
      writeFileSync(join(dir, "keys.json"), JSON.stringify({ "plant.water": {} }));
      for (const loc of ["en-us", "fr-fr"]) {
        writeFileSync(
          join(dir, "locales", `${loc}.json`),
          JSON.stringify({ "plant.water": { state: "reviewed", value: "Water your plant, {gardener}" } }),
        );
      }
      return dir;
    }

    it("never treats the catalog directory as a locale source", () => {
      expect(detect(makeCatalog())).toBeNull();
    });

    it("never treats the catalog's locales/ directory as a locale source", () => {
      expect(detect(join(makeCatalog(), "locales"))).toBeNull();
    });

    it("ignores the catalog even with an explicit format override", () => {
      expect(detect(join(makeCatalog(), "locales"), "vue-i18n-json")).toBeNull();
    });
  });
});
