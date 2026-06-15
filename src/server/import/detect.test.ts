import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
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
});
