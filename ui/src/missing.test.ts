import { describe, it, expect } from "vitest";
import { isTargetMissing, missingTargetLocales, staleTargetLocales } from "./missing.js";
import type { KeyEntry } from "./types.js";

describe("isTargetMissing", () => {
  it("scalar: flags a target with no value", () => {
    const entry: KeyEntry = { values: { en: { value: "Hi", state: "source" } } };
    expect(isTargetMissing(entry, "de", "en")).toBe(true);
  });

  it("scalar: passes a target that already has a value", () => {
    const entry: KeyEntry = {
      values: { en: { value: "Hi", state: "source" }, de: { value: "Hallo", state: "reviewed" } },
    };
    expect(isTargetMissing(entry, "de", "en")).toBe(false);
  });

  it("scalar: nothing is missing when the source itself is empty", () => {
    const entry: KeyEntry = { values: { en: { value: "", state: "source" } } };
    expect(isTargetMissing(entry, "de", "en")).toBe(false);
  });

  it("never flags the source locale", () => {
    const entry: KeyEntry = { values: { en: { value: "Hi", state: "source" } } };
    expect(isTargetMissing(entry, "en", "en")).toBe(false);
  });

  it("plural: passes a target whose required forms are all filled", () => {
    const entry: KeyEntry = {
      plural: { arg: "count" },
      values: {
        en: { forms: { one: "1", other: "n" }, state: "source" },
        de: { forms: { one: "1", other: "n" }, state: "reviewed" },
      },
    };
    expect(isTargetMissing(entry, "de", "en")).toBe(false);
  });

  it("plural: flags a target missing a required category", () => {
    const entry: KeyEntry = {
      plural: { arg: "count" },
      values: {
        en: { forms: { one: "1", other: "n" }, state: "source" },
        de: { forms: { other: "n" }, state: "reviewed" },
      },
    };
    expect(isTargetMissing(entry, "de", "en")).toBe(true);
  });

  it("plural: nothing is missing when the source has no `other` form", () => {
    const entry: KeyEntry = {
      plural: { arg: "count" },
      values: { en: { forms: { one: "1" }, state: "source" } },
    };
    expect(isTargetMissing(entry, "de", "en")).toBe(false);
  });
});

describe("missingTargetLocales", () => {
  it("returns only the untranslated targets, excluding the source", () => {
    const entry: KeyEntry = {
      plural: { arg: "count" },
      values: {
        en: { forms: { one: "1", other: "n" }, state: "source" },
        // Every canonical form filled, so fr is complete regardless of which
        // CLDR categories Intl reports for it.
        fr: { forms: { zero: "0", one: "1", two: "2", few: "f", many: "m", other: "n" }, state: "reviewed" },
        de: { forms: {}, state: "needs-review" },
      },
    };
    expect(missingTargetLocales(entry, ["en", "fr", "de"], "en")).toEqual(["de"]);
  });
});

describe("staleTargetLocales", () => {
  it("returns locales that are needs-review AND have a non-empty scalar value", () => {
    const entry: KeyEntry = {
      values: {
        en: { value: "Hello", state: "source" },
        fr: { value: "Bonjour", state: "needs-review" },
        de: { value: "", state: "needs-review" },
      },
    };
    expect(staleTargetLocales(entry, ["en", "fr", "de"], "en")).toEqual(["fr"]);
  });

  it("excludes the source locale", () => {
    const entry: KeyEntry = {
      values: {
        en: { value: "Hello", state: "needs-review" },
        fr: { value: "Bonjour", state: "needs-review" },
      },
    };
    expect(staleTargetLocales(entry, ["en", "fr"], "en")).toEqual(["fr"]);
  });

  it("excludes locales that are needs-review but have an empty value", () => {
    const entry: KeyEntry = {
      values: {
        en: { value: "Hello", state: "source" },
        fr: { value: "", state: "needs-review" },
      },
    };
    expect(staleTargetLocales(entry, ["en", "fr"], "en")).toEqual([]);
  });

  it("excludes locales that are reviewed or machine", () => {
    const entry: KeyEntry = {
      values: {
        en: { value: "Hello", state: "source" },
        fr: { value: "Bonjour", state: "reviewed" },
        de: { value: "Hallo", state: "machine" },
      },
    };
    expect(staleTargetLocales(entry, ["en", "fr", "de"], "en")).toEqual([]);
  });

  it("includes plural locales that are needs-review AND have forms", () => {
    const entry: KeyEntry = {
      plural: { arg: "n" },
      values: {
        en: { forms: { other: "items" }, state: "source" },
        fr: { forms: { one: "article", other: "articles" }, state: "needs-review" },
      },
    };
    expect(staleTargetLocales(entry, ["en", "fr"], "en")).toEqual(["fr"]);
  });

  it("excludes plural locales that are needs-review but have no forms", () => {
    const entry: KeyEntry = {
      plural: { arg: "n" },
      values: {
        en: { forms: { other: "items" }, state: "source" },
        fr: { forms: {}, state: "needs-review" },
      },
    };
    expect(staleTargetLocales(entry, ["en", "fr"], "en")).toEqual([]);
  });
});
