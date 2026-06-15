import { describe, it, expect } from "vitest";
import { countWords, namespaceOf, pct } from "./stats.js";
import { computeStats } from "./stats.js";
import { defaultState } from "./schema.js";
import type { State } from "./schema.js";

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("hello brave world")).toBe(3);
  });
  it("is zero for empty / whitespace-only", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
  it("collapses runs of whitespace", () => {
    expect(countWords("  a\t b\n c ")).toBe(3);
  });
});

describe("namespaceOf", () => {
  it("returns the segment before the first dot", () => {
    expect(namespaceOf("auth.signIn.button")).toBe("auth");
  });
  it("groups dotless keys under (root)", () => {
    expect(namespaceOf("welcome")).toBe("(root)");
  });
});

describe("pct", () => {
  it("returns a one-decimal percentage", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 2)).toBe(50);
  });
  it("is zero when the denominator is zero", () => {
    expect(pct(0, 0)).toBe(0);
  });
});

function stateWith(keys: State["keys"], locales = ["en", "fr"]): State {
  const s = defaultState();
  s.config.locales = locales;
  s.keys = keys;
  return s;
}

describe("computeStats", () => {
  it("buckets each target locale's values by state", () => {
    const s = stateWith({
      a: { values: { en: { value: "A", state: "source" }, fr: { value: "A-fr", state: "reviewed" } } },
      b: { values: { en: { value: "B", state: "source" }, fr: { value: "B-fr", state: "needs-review" } } },
      c: { values: { en: { value: "C", state: "source" }, fr: { value: "C-fr", state: "machine" } } },
      d: { values: { en: { value: "D", state: "source" } } },
    });
    const fr = computeStats(s).locales.find((l) => l.locale === "fr")!;
    expect(fr.counts).toEqual({ reviewed: 1, needsReview: 1, machine: 1, missing: 1 });
    expect(fr.total).toBe(4);
    expect(fr.translated).toBe(3);
    expect(fr.reviewed).toBe(1);
    expect(fr.translatedPct).toBe(75);
    expect(fr.reviewedPct).toBe(25);
  });

  it("treats an empty target value as missing (not machine)", () => {
    const s = stateWith({
      a: { values: { en: { value: "A", state: "source" }, fr: { value: "", state: "needs-review" } } },
    });
    const fr = computeStats(s).locales.find((l) => l.locale === "fr")!;
    expect(fr.counts.missing).toBe(1);
    expect(fr.counts.needsReview).toBe(0);
  });

  it("uses the plural `other` form for presence", () => {
    const s = stateWith({
      plural: {
        plural: { arg: "count" },
        values: {
          en: { forms: { other: "{count} items" }, state: "source" },
          fr: { forms: { other: "{count} articles" }, state: "reviewed" },
        },
      },
      empty: {
        plural: { arg: "count" },
        values: {
          en: { forms: { other: "{count} items" }, state: "source" },
          fr: { forms: { other: "" }, state: "machine" },
        },
      },
    });
    const fr = computeStats(s).locales.find((l) => l.locale === "fr")!;
    expect(fr.counts.reviewed).toBe(1);
    expect(fr.counts.missing).toBe(1);
  });

  it("excludes skipTranslate keys from the denominator", () => {
    const s = stateWith({
      a: { values: { en: { value: "A", state: "source" }, fr: { value: "A-fr", state: "reviewed" } } },
      skip: { skipTranslate: true, values: { en: { value: "S", state: "source" } } },
    });
    const fr = computeStats(s).locales.find((l) => l.locale === "fr")!;
    expect(fr.total).toBe(1);
    expect(fr.translatedPct).toBe(100);
  });

  it("counts source words and words still missing per locale", () => {
    const s = stateWith({
      a: { values: { en: { value: "one two three", state: "source" }, fr: { value: "x", state: "reviewed" } } },
      b: { values: { en: { value: "four five", state: "source" } } },
    });
    const fr = computeStats(s).locales.find((l) => l.locale === "fr")!;
    expect(fr.words.source).toBe(5);
    expect(fr.words.missing).toBe(2);
  });

  it("rolls up by namespace and by tag", () => {
    const s = stateWith({
      "auth.in": { values: { en: { value: "In", state: "source" }, fr: { value: "fr", state: "reviewed" } } },
      "auth.out": { tags: ["t1"], values: { en: { value: "Out", state: "source" } } },
      welcome: { tags: ["t1"], values: { en: { value: "Hi", state: "source" }, fr: { value: "fr", state: "reviewed" } } },
    });
    const stats = computeStats(s);
    const auth = stats.byNamespace.find((g) => g.name === "auth")!;
    expect(auth.total).toBe(2);
    expect(auth.translatedPct).toBe(50);
    expect(stats.byNamespace.find((g) => g.name === "(root)")!.total).toBe(1);
    const t1 = stats.byTag.find((g) => g.name === "t1")!;
    expect(t1.total).toBe(2);
    // "auth.in" has no tags -> contributes to no tag group.
    expect(stats.byTag.reduce((n, g) => n + g.total, 0)).toBe(2);
  });

  it("computes micro-averaged project totals", () => {
    const s = stateWith(
      {
        a: { values: { en: { value: "A", state: "source" }, fr: { value: "f", state: "reviewed" }, de: { value: "d", state: "machine" } } },
        b: { values: { en: { value: "B", state: "source" } } },
      },
      ["en", "fr", "de"],
    );
    const t = computeStats(s).totals;
    expect(t.keys).toBe(2);
    expect(t.locales).toBe(2);
    // cells = 2 keys * 2 targets = 4; translated = fr(a)+de(a) = 2 -> 50%
    expect(t.translatedPct).toBe(50);
    // reviewed = fr(a) = 1 -> 25%
    expect(t.reviewedPct).toBe(25);
    expect(t.sourceWords).toBe(2);
  });

  it("excludes skipTranslate keys from totals.sourceWords", () => {
    const s = stateWith({
      a: { values: { en: { value: "one two", state: "source" }, fr: { value: "x", state: "reviewed" } } },
      skip: { skipTranslate: true, values: { en: { value: "three four five", state: "source" } } },
    });
    const t = computeStats(s).totals;
    expect(t.sourceWords).toBe(2);
  });

  it("returns zeroed stats for an empty catalog", () => {
    const stats = computeStats(stateWith({}));
    expect(stats.totals.keys).toBe(0);
    expect(stats.totals.translatedPct).toBe(0);
    const fr = stats.locales.find((l) => l.locale === "fr")!;
    expect(fr.total).toBe(0);
    expect(fr.translatedPct).toBe(0);
  });
});
