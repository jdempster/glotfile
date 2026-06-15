import { describe, it, expect } from "vitest";
import { buildCockpit, drillFilterFor } from "./cockpit.js";
import type { State, LintFinding, LintReport } from "@/types.js";

// en → fr, de.  fr is fully translated but has a breaking placeholder issue, one
// stale (needs-review) string and one length warning. de is missing one string.
function fixture(): State {
  return {
    version: 1,
    config: {
      sourceLocale: "en",
      locales: ["en", "fr", "de"],
      outputs: [],
      format: { indent: 2, sortKeys: true, finalNewline: true },
    },
    keys: {
      "app.title": {
        values: {
          en: { value: "Glotfile", state: "source" },
          fr: { value: "Glotfile", state: "machine" },
          de: { value: "Glotfile", state: "machine" },
        },
      },
      "home.welcome": {
        values: {
          en: { value: "Welcome {name}", state: "source" },
          fr: { value: "Bonjour", state: "needs-review" },
          // de: missing entirely
        },
      },
      "checkout.pay": {
        values: {
          en: { value: "Pay {amount}", state: "source" },
          fr: { value: "Payer", state: "machine" },
          de: { value: "Bezahlen", state: "machine" },
        },
      },
    },
  };
}

function report(findings: LintFinding[]): LintReport {
  const error = findings.filter((f) => f.severity === "error").length;
  return { findings, counts: { error, warn: findings.length - error, suppressed: 0 }, ok: error === 0 };
}

// What `glotfile check` would emit for the fixture.
const findings: LintFinding[] = [
  { ruleId: "placeholder-mismatch", key: "checkout.pay", locale: "fr", severity: "error", message: "placeholders differ from the source" },
  { ruleId: "max-length", key: "app.title", locale: "fr", severity: "warn", message: "too long" },
  // completion, not a content issue — drives the "missing" dimension instead
  { ruleId: "empty-translation", key: "home.welcome", locale: "de", severity: "error", message: "translation is empty or missing" },
];

describe("buildCockpit — per-locale readiness", () => {
  it("blocks a locale with a breaking issue and lists its blockers", () => {
    const fr = buildCockpit(fixture(), report(findings)).locales.find((l) => l.locale === "fr")!;
    expect(fr.verdict).toBe("blocked");
    expect(fr.breaking).toBe(1);
    expect(fr.warning).toBe(1);
    expect(fr.pct).toBe(100);
    expect(fr.blockers).toContain("1 breaking");
  });

  it("treats needs-review as stale", () => {
    const fr = buildCockpit(fixture(), report(findings)).locales.find((l) => l.locale === "fr")!;
    expect(fr.counts.needsReview).toBe(1);
    expect(fr.staleKeys).toEqual(["home.welcome"]);
  });

  it("blocks a locale with a missing string (from the empty-translation rule)", () => {
    const de = buildCockpit(fixture(), report(findings)).locales.find((l) => l.locale === "de")!;
    expect(de.verdict).toBe("blocked");
    expect(de.missingKeys).toEqual(["home.welcome"]);
    expect(de.pct).toBe(67);
  });

  it("does not block on missing strings when empty-translation is configured off", () => {
    const withoutRule = findings.filter((f) => f.ruleId !== "empty-translation");
    const de = buildCockpit(fixture(), report(withoutRule)).locales.find((l) => l.locale === "de")!;
    expect(de.missingKeys).toEqual([]);
    expect(de.verdict).toBe("ready");
    // the composition counts still reflect reality
    expect(de.counts.missing).toBe(1);
  });

  it("marks a clean locale as ready when the report has no findings for it", () => {
    const state = fixture();
    state.keys["home.welcome"]!.values.fr = { value: "Bienvenue {name}", state: "machine" };
    state.keys["checkout.pay"]!.values.fr = { value: "Payer {amount}", state: "machine" };
    const fr = buildCockpit(state, report([])).locales.find((l) => l.locale === "fr")!;
    expect(fr.verdict).toBe("ready");
    expect(fr.blockers).toEqual([]);
  });
});

describe("buildCockpit — project-level findings", () => {
  it("separates locale-less findings and counts their errors", () => {
    const c = buildCockpit(fixture(), report([
      { ruleId: "empty-source", key: "app.title", locale: "", severity: "error", message: "source value is empty" },
      { ruleId: "output-stale", key: "locales/fr.json", locale: "", severity: "error", message: "output file is out of date; run `glotfile export`" },
    ]));
    expect(c.project).toHaveLength(2);
    expect(c.projectErrors).toBe(2);
    // project findings never land on a locale card
    expect(c.locales.every((l) => l.breaking === 0)).toBe(true);
  });
});

describe("buildCockpit — totals", () => {
  it("counts verdicts and aggregates risk across locales", () => {
    const c = buildCockpit(fixture(), report(findings));
    expect(c.totals.locales).toBe(2);
    expect(c.totals.blocked).toBe(2);
    expect(c.totals.ready).toBe(0);
    expect(c.totals.breaking).toBe(1);
    expect(c.totals.missing).toBe(1);
    expect(c.totals.stale).toBe(1);
    // openIssues = content issues only (empty-translation excluded)
    expect(c.totals.openIssues).toBe(2);
  });
});

describe("buildCockpit — quality risk grouping", () => {
  it("groups content findings by severity and excludes empty-translation", () => {
    const c = buildCockpit(fixture(), report(findings));
    expect(c.risk.breaking.map((f) => f.ruleId)).toEqual(["placeholder-mismatch"]);
    expect(c.risk.warning.map((f) => f.ruleId)).toEqual(["max-length"]);
  });
});

describe("buildCockpit — prioritized worklist", () => {
  it("orders breaking → missing → stale → warning and flags drill filters", () => {
    const c = buildCockpit(fixture(), report(findings));
    expect(c.worklist.map((w) => w.priority)).toEqual(["breaking", "missing", "stale", "warning"]);

    const breaking = c.worklist[0]!;
    expect(breaking.filter).toMatchObject({ issues: ["placeholder"], locale: "fr" });

    const missing = c.worklist.find((w) => w.priority === "missing")!;
    expect(missing.filter).toMatchObject({ text: "home.welcome", states: ["missing"] });

    const stale = c.worklist.find((w) => w.priority === "stale")!;
    expect(stale.filter).toMatchObject({ states: ["needs-review"] });

    const warning = c.worklist.find((w) => w.priority === "warning")!;
    expect(warning.filter).toMatchObject({ issues: ["length"] });
  });

  it("gives a stale-output item no drill filter", () => {
    const c = buildCockpit(fixture(), report([
      { ruleId: "output-stale", key: "locales/fr.json", locale: "", severity: "error", message: "output file is out of date; run `glotfile export`" },
    ]));
    const item = c.worklist.find((w) => w.id.includes("output-stale"))!;
    expect(item.priority).toBe("breaking");
    expect(item.filter).toBeUndefined();
  });
});

describe("drillFilterFor", () => {
  it("maps editor-representable rules to issue filters", () => {
    expect(drillFilterFor({ ruleId: "placeholder-mismatch", key: "k", locale: "fr", severity: "error", message: "" }))
      .toEqual({ locale: "fr", issues: ["placeholder"] });
    expect(drillFilterFor({ ruleId: "spelling", key: "k", locale: "fr", severity: "warn", message: "" }))
      .toEqual({ locale: "fr", issues: ["spelling"] });
  });
  it("falls back to a key text filter for rules without an editor check", () => {
    expect(drillFilterFor({ ruleId: "identical-to-source", key: "k", locale: "fr", severity: "warn", message: "" }))
      .toEqual({ locale: "fr", text: "k" });
    expect(drillFilterFor({ ruleId: "empty-source", key: "k", locale: "", severity: "error", message: "" }))
      .toEqual({ text: "k" });
  });
});
