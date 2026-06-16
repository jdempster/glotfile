import { describe, it, expect } from "vitest";
import { resolvePath, getAdapter, listAdapters } from "./index.js";

describe("resolvePath", () => {
  it("substitutes {locale} and {namespace}", () => {
    expect(resolvePath("lang/{locale}/{namespace}.php", "fr", "auth")).toBe("lang/fr/auth.php");
    expect(resolvePath("lib/l10n/app_{locale}.arb", "de")).toBe("lib/l10n/app_de.arb");
  });
});

describe("registry", () => {
  it("exposes the built-in and new plural-aware adapters", () => {
    expect(listAdapters().sort()).toEqual([
      "angular-xliff",
      "apple-strings",
      "apple-stringsdict",
      "flutter-arb",
      "gettext-po",
      "i18next-json",
      "laravel-php",
      "next-intl-json",
      "rails-yaml",
      "vue-i18n-json",
    ]);
    expect(getAdapter("flutter-arb").name).toBe("flutter-arb");
    expect(getAdapter("i18next-json").name).toBe("i18next-json");
  });
  it("every registered adapter exposes a capabilities descriptor", () => {
    for (const name of listAdapters()) {
      const caps = getAdapter(name).capabilities;
      expect(caps).toBeDefined();
      expect(typeof caps.plural).toBe("string");
      expect(typeof caps.fileGrouping).toBe("string");
    }
  });
  it("throws on unknown adapter", () => {
    expect(() => getAdapter("nope")).toThrow(/Unknown adapter/);
  });
});
