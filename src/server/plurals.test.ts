import { describe, it, expect } from "vitest";
import { categoriesFor, parseIcuPlural, formsToIcu, exactFormsToCldr, gettextPluralForms } from "./plurals.js";

describe("categoriesFor", () => {
  it("returns CLDR cardinal categories in canonical order", () => {
    expect(categoriesFor("en")).toEqual(["one", "other"]);
    expect(categoriesFor("ja")).toEqual(["other"]);
    expect(categoriesFor("pl")).toEqual(["one", "few", "many", "other"]);
  });

  it("includes zero/two for Arabic, canonically ordered", () => {
    expect(categoriesFor("ar")).toEqual(["zero", "one", "two", "few", "many", "other"]);
  });

  it("falls back to ['other'] for an unknown tag", () => {
    expect(categoriesFor("zz-nonsense-xx")).toEqual(["other"]);
  });

  it("normalizes underscore locale codes to BCP-47 so region locales keep their categories", () => {
    expect(categoriesFor("en_us")).toEqual(["one", "other"]);
    expect(categoriesFor("pt_br")).toEqual(["one", "many", "other"]);
  });
});

describe("parseIcuPlural", () => {
  it("parses a simple one/other plural and normalizes # to {arg}", () => {
    expect(parseIcuPlural("{count, plural, one {# item} other {# items}}")).toEqual({
      arg: "count",
      forms: { one: "{count} item", other: "{count} items" },
    });
  });

  it("keeps nested braces inside a branch body intact", () => {
    expect(parseIcuPlural("{n, plural, one {a {x} b} other {c {y} d}}")).toEqual({
      arg: "n",
      forms: { one: "a {x} b", other: "c {y} d" },
    });
  });

  it("returns null for plain text", () => {
    expect(parseIcuPlural("just text")).toBeNull();
  });

  it("returns null when text surrounds the plural", () => {
    expect(parseIcuPlural("You have {count, plural, one {#} other {#}} left")).toBeNull();
  });

  it("returns null for select (not plural)", () => {
    expect(parseIcuPlural("{g, select, male {he} other {they}}")).toBeNull();
  });

  it("parses exact-match (=N) selectors alongside categories", () => {
    expect(parseIcuPlural("{count, plural, =0 {none} other {#}}")).toEqual({
      arg: "count",
      forms: { "=0": "none", other: "{count}" },
    });
  });

  it("parses a kiosk-style =1/other exact plural with no space before the brace", () => {
    expect(
      parseIcuPlural("{count, plural, =1{Failed to collect delivery} other{Failed to collect deliveries}}"),
    ).toEqual({
      arg: "count",
      forms: { "=1": "Failed to collect delivery", other: "Failed to collect deliveries" },
    });
  });

  it("returns null when 'other' is missing", () => {
    expect(parseIcuPlural("{count, plural, one {#}}")).toBeNull();
  });

  it("returns null on a duplicate category (rather than silently dropping a branch)", () => {
    expect(parseIcuPlural("{count, plural, one {#} one {# again} other {#}}")).toBeNull();
  });
});

describe("formsToIcu", () => {
  it("serializes forms in canonical category order", () => {
    expect(formsToIcu("count", { other: "{count} items", one: "{count} item" })).toBe(
      "{count, plural, one {{count} item} other {{count} items}}",
    );
  });

  it("round-trips with parseIcuPlural", () => {
    const icu = "{count, plural, one {{count} item} other {{count} items}}";
    const parsed = parseIcuPlural(icu)!;
    expect(formsToIcu(parsed.arg, parsed.forms)).toBe(icu);
  });

  it("emits exact (=N) selectors before keyword categories, numerically ordered", () => {
    expect(formsToIcu("count", { other: "{count} items", "=1": "one item", "=0": "no items" })).toBe(
      "{count, plural, =0 {no items} =1 {one item} other {{count} items}}",
    );
  });

  it("round-trips a =1/other exact plural", () => {
    const icu = "{count, plural, =1 {Failed} other {Failed plural}}";
    const parsed = parseIcuPlural(icu)!;
    expect(formsToIcu(parsed.arg, parsed.forms)).toBe(icu);
  });
});

describe("exactFormsToCldr", () => {
  // kiosk's degenerate plural: =1 is the singular, other is the plural.
  const kiosk = { "=1": "Failed to collect delivery", other: "Failed to collect deliveries" };

  it("maps =1 to 'one' and fills 'other' for English", () => {
    expect(exactFormsToCldr("en", kiosk)).toEqual({
      one: "Failed to collect delivery",
      other: "Failed to collect deliveries",
    });
  });

  it("folds =1 away for a locale with no 'one' category (ja)", () => {
    expect(exactFormsToCldr("ja", kiosk)).toEqual({ other: "Failed to collect deliveries" });
  });

  it("expands to one/few/many/other for Russian, filling the rest from 'other'", () => {
    expect(exactFormsToCldr("ru", kiosk)).toEqual({
      one: "Failed to collect delivery",
      few: "Failed to collect deliveries",
      many: "Failed to collect deliveries",
      other: "Failed to collect deliveries",
    });
  });

  it("fills every Arabic category, routing =1 to 'one'", () => {
    expect(exactFormsToCldr("ar", kiosk)).toEqual({
      zero: "Failed to collect deliveries",
      one: "Failed to collect delivery",
      two: "Failed to collect deliveries",
      few: "Failed to collect deliveries",
      many: "Failed to collect deliveries",
      other: "Failed to collect deliveries",
    });
  });

  it("leaves already-CLDR forms unchanged (no exact selectors)", () => {
    const cldr = { one: "{count} item", other: "{count} items" };
    expect(exactFormsToCldr("en", cldr)).toEqual(cldr);
  });

  it("keeps an existing category form over the 'other' fallback", () => {
    // few is already translated distinctly; conversion must not clobber it.
    const forms = { "=1": "one", few: "a few", other: "lots" };
    expect(exactFormsToCldr("ru", forms)).toEqual({
      one: "one",
      few: "a few",
      many: "lots",
      other: "lots",
    });
  });
});

describe("gettextPluralForms", () => {
  function canonicalIndex(locale: string, n: number): number {
    const cats = categoriesFor(locale);
    return cats.indexOf(new Intl.PluralRules(locale, { type: "cardinal" }).select(n));
  }

  it("emits the canonical 2-form English expression (not sampled)", () => {
    expect(gettextPluralForms("en")).toEqual({ nplurals: 2, expr: "(n != 1)", sampled: false });
  });

  it("emits a single form for Japanese", () => {
    expect(gettextPluralForms("ja")).toEqual({ nplurals: 1, expr: "0", sampled: false });
  });

  it("does NOT use the English shortcut for a zero-is-one 2-form locale (hi)", () => {
    const { nplurals, expr, sampled } = gettextPluralForms("hi");
    expect(nplurals).toBe(2);
    // Hindi's rule makes 0 the "one" form, so (n != 1) would be wrong.
    expect(expr).not.toBe("(n != 1)");
    expect(sampled).toBe(true);
    const f = new Function("n", `return (${expr});`) as (n: number) => number;
    expect(f(0)).toBe(0);
    for (let n = 0; n <= 200; n++) {
      expect(f(n)).toBe(canonicalIndex("hi", n));
    }
  });

  it("generates an expression that agrees with Intl for n in 0..200 (pl, ru, ar)", () => {
    for (const locale of ["pl", "ru", "ar"]) {
      const { nplurals, expr, sampled } = gettextPluralForms(locale);
      expect(nplurals).toBe(categoriesFor(locale).length);
      expect(sampled).toBe(true);
      // Safe: `expr` is generated solely from Intl.PluralRules output + integer
      // literals (no external input); evaluating it is the faithful way to prove
      // the emitted C expression matches Intl over the sampled domain.
      const f = new Function("n", `return (${expr});`) as (n: number) => number;
      for (let n = 0; n <= 200; n++) {
        expect(f(n)).toBe(canonicalIndex(locale, n));
      }
    }
  });
});
