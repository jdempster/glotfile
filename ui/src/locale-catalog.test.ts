import { describe, it, expect } from "vitest";
import { LOCALE_CATALOG, isKnownLocale } from "./locale-catalog.js";

describe("locale catalog", () => {
  it("ships a comprehensive list of languages and regional locales", () => {
    expect(LOCALE_CATALOG.length).toBeGreaterThan(500);
    // base languages
    expect(LOCALE_CATALOG).toContain("es");
    expect(LOCALE_CATALOG).toContain("ar");
    // regional + script variants
    expect(LOCALE_CATALOG).toContain("es-MX");
    expect(LOCALE_CATALOG).toContain("pt-BR");
    expect(LOCALE_CATALOG).toContain("zh-Hans");
  });

  it("has no duplicates and excludes 'und'", () => {
    expect(new Set(LOCALE_CATALOG).size).toBe(LOCALE_CATALOG.length);
    expect(LOCALE_CATALOG).not.toContain("und");
  });

  it("isKnownLocale matches catalog entries case-insensitively", () => {
    expect(isKnownLocale("es-MX")).toBe(true);
    expect(isKnownLocale("ES-mx")).toBe(true);
    expect(isKnownLocale("  fr  ")).toBe(true);
  });

  it("isKnownLocale rejects custom/invented locales", () => {
    expect(isKnownLocale("yoda")).toBe(false);
    expect(isKnownLocale("en-pirate")).toBe(false);
    expect(isKnownLocale("")).toBe(false);
  });
});
