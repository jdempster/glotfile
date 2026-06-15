import { describe, it, expect } from "vitest";
import { sourceHash, findSuppression, pruneStaleSuppressions } from "./suppress.js";
import { runLint } from "./run.js";
import { addSuppression, removeSuppression, setSourceValue, setSourcePluralForms, removeLocale } from "../state.js";
import { validate } from "../schema.js";
import type { State, KeyEntry } from "../schema.js";

const clock = () => "2026-01-01T00:00:00.000Z";
const quiet = { loadSpeller: async () => null, warn: () => {} };

function state(): State {
  return {
    version: 1,
    config: {
      sourceLocale: "en", locales: ["en", "fr"], outputs: [],
      format: { indent: 2, sortKeys: true, finalNewline: true },
    },
    glossary: [],
    keys: {
      "a.key": { values: { en: { value: "Logo", state: "source" }, fr: { value: "Logo", state: "reviewed" } } },
      "p.key": {
        plural: { arg: "n" },
        values: {
          en: { forms: { one: "{n} file", other: "{n} files" }, state: "source" },
          fr: { forms: { one: "{n} file", other: "{n} files" }, state: "reviewed" },
        },
      },
    },
  };
}

describe("sourceHash", () => {
  it("is stable across insignificant whitespace and changes with content", () => {
    const s = state();
    const entry = s.keys["a.key"]!;
    const before = sourceHash(entry, "en");
    entry.values.en!.value = "Logo";
    expect(sourceHash(entry, "en")).toBe(before);
    entry.values.en!.value = "Logotype";
    expect(sourceHash(entry, "en")).not.toBe(before);
  });

  it("covers plural forms and is order-independent", () => {
    const s = state();
    const entry = s.keys["p.key"]!;
    const before = sourceHash(entry, "en");
    entry.values.en!.forms = { other: "{n} files", one: "{n} file" };
    expect(sourceHash(entry, "en")).toBe(before);
    entry.values.en!.forms = { one: "{n} file", other: "{n} docs" };
    expect(sourceHash(entry, "en")).not.toBe(before);
  });
});

describe("addSuppression / removeSuppression", () => {
  it("records rule, locale, source hash and timestamp", () => {
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    const sup = s.keys["a.key"]!.suppressions![0]!;
    expect(sup).toMatchObject({ rule: "identical-to-source", locale: "fr", at: clock() });
    expect(sup.source).toBe(sourceHash(s.keys["a.key"]!, "en"));
  });

  it("replaces an existing suppression for the same rule+locale", () => {
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    expect(s.keys["a.key"]!.suppressions).toHaveLength(1);
  });

  it("rejects unknown rule ids", () => {
    const s = state();
    expect(() => addSuppression(s, "a.key", "nope", "fr", clock)).toThrow(/rule/i);
  });

  it("removeSuppression drops the entry and the empty array", () => {
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    removeSuppression(s, "a.key", "identical-to-source", "fr");
    expect(s.keys["a.key"]!.suppressions).toBeUndefined();
  });
});

describe("findSuppression / staleness", () => {
  it("matches only while the source hash is current", () => {
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    const entry = s.keys["a.key"]!;
    expect(findSuppression(entry, "en", "identical-to-source", "fr")).toBeTruthy();
    entry.values.en!.value = "Logotype";
    expect(findSuppression(entry, "en", "identical-to-source", "fr")).toBeUndefined();
  });

  it("pruneStaleSuppressions removes only stale entries", () => {
    const s = state();
    const entry = s.keys["a.key"]!;
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    entry.suppressions!.push({ rule: "whitespace", locale: "fr", source: "deadbeef" });
    pruneStaleSuppressions(entry, "en");
    expect(entry.suppressions).toHaveLength(1);
    expect(entry.suppressions![0]!.rule).toBe("identical-to-source");
  });
});

describe("source edits expire suppressions", () => {
  it("setSourceValue prunes suppressions when the source meaningfully changes", () => {
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    setSourceValue(s, "a.key", "Logo "); // whitespace-only change: keep
    expect(s.keys["a.key"]!.suppressions).toHaveLength(1);
    setSourceValue(s, "a.key", "Logotype");
    expect(s.keys["a.key"]!.suppressions).toBeUndefined();
  });

  it("setSourcePluralForms prunes suppressions when forms change", () => {
    const s = state();
    addSuppression(s, "p.key", "identical-to-source", "fr", clock);
    setSourcePluralForms(s, "p.key", { one: "{n} file", other: "{n} files" });
    expect(s.keys["p.key"]!.suppressions).toHaveLength(1);
    setSourcePluralForms(s, "p.key", { one: "{n} doc", other: "{n} docs" });
    expect(s.keys["p.key"]!.suppressions).toBeUndefined();
  });

  it("removeLocale drops that locale's suppressions", () => {
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    removeLocale(s, "fr");
    expect(s.keys["a.key"]!.suppressions).toBeUndefined();
  });
});

describe("runLint with suppressions", () => {
  it("drops suppressed findings and reports a suppressed count", async () => {
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    const r = await runLint(s, quiet);
    expect(r.findings.some((f) => f.key === "a.key" && f.ruleId === "identical-to-source")).toBe(false);
    expect(r.counts.suppressed).toBe(1);
  });

  it("includeSuppressed keeps them, flagged, without affecting counts or ok", async () => {
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    const r = await runLint(s, { ...quiet, includeSuppressed: true });
    const f = r.findings.find((x) => x.key === "a.key" && x.ruleId === "identical-to-source");
    expect(f?.suppressed).toBe(true);
    expect(r.counts.warn).toBe(0);
    expect(r.counts.suppressed).toBe(1);
  });

  it("a stale suppression no longer hides the finding", async () => {
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    // Simulate an out-of-band source edit that bypassed the setters.
    s.keys["a.key"]!.values.en!.value = "Brand";
    s.keys["a.key"]!.values.fr!.value = "Brand";
    const r = await runLint(s, quiet);
    expect(r.findings.some((f) => f.key === "a.key" && f.ruleId === "identical-to-source")).toBe(true);
    expect(r.counts.suppressed).toBe(0);
  });
});

describe("split storage", () => {
  it("suppressions survive disassemble/assemble", async () => {
    const { disassemble, assemble } = await import("../storage.js");
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    const reloaded = validate(assemble(disassemble(s)));
    expect(reloaded.keys["a.key"]!.suppressions).toEqual(s.keys["a.key"]!.suppressions);
  });
});

describe("schema validation", () => {
  it("accepts valid suppressions and rejects malformed ones", () => {
    const s = state();
    addSuppression(s, "a.key", "identical-to-source", "fr", clock);
    const reloaded = validate(JSON.parse(JSON.stringify(s)));
    expect(reloaded.keys["a.key"]!.suppressions).toHaveLength(1);

    const bad = JSON.parse(JSON.stringify(s));
    bad.keys["a.key"].suppressions[0].rule = "not-a-rule";
    expect(() => validate(bad)).toThrow(/suppression/i);

    const bad2 = JSON.parse(JSON.stringify(s));
    bad2.keys["a.key"].suppressions = [{ locale: "fr" }];
    expect(() => validate(bad2)).toThrow(/suppression/i);
  });
});

describe("acceptFindings", () => {
  it("suppresses current warning findings, filtered by rule and locale", async () => {
    const { acceptFindings } = await import("./accept.js");
    const s = state();
    const r = await runLint(s, quiet);
    const result = acceptFindings(s, r.findings, { rules: ["identical-to-source"], locales: ["fr"] }, clock);
    expect(result.accepted).toBe(1);
    expect(s.keys["a.key"]!.suppressions).toHaveLength(1);
    const after = await runLint(s, quiet);
    expect(after.findings.some((f) => f.ruleId === "identical-to-source")).toBe(false);
  });

  it("skips errors, project-level and already-suppressed findings by default", async () => {
    const { acceptFindings } = await import("./accept.js");
    const s = state();
    s.keys["e.key"] = { values: { en: { value: "Hi {n}", state: "source" }, fr: { value: "Salut", state: "reviewed" } } };
    const r = await runLint(s, quiet);
    expect(r.findings.some((f) => f.severity === "error")).toBe(true);
    const result = acceptFindings(s, r.findings, {}, clock);
    expect(result.byRule["placeholder-mismatch"]).toBeUndefined();
    expect(result.byRule["identical-to-source"]).toBe(1);
    // Accepting again is a no-op: the findings are already suppressed.
    const again = acceptFindings(s, (await runLint(s, quiet)).findings, {}, clock);
    expect(again.accepted).toBe(0);
  });
});

describe("runChecks respects quality config", () => {
  it("drops issues whose mapped lint rule is suppressed for that key+locale", async () => {
    const { runChecks } = await import("../checks.js");
    const s = state();
    s.keys["m.key"] = {
      maxLength: 3,
      values: { en: { value: "Hi", state: "source" }, fr: { value: "Bonjour", state: "reviewed" } },
    };
    expect(runChecks(s).issues.filter((i) => i.check === "length")).toHaveLength(1);
    addSuppression(s, "m.key", "max-length", "fr", clock);
    expect(runChecks(s).issues.filter((i) => i.check === "length")).toHaveLength(0);
  });

  it("drops issues whose mapped lint rule is configured off", async () => {
    const { runChecks } = await import("../checks.js");
    const s = state();
    s.keys["m.key"] = {
      maxLength: 3,
      values: { en: { value: "Hi", state: "source" }, fr: { value: "Bonjour", state: "reviewed" } },
    };
    s.config.lint = { rules: { "max-length": "off" } };
    expect(runChecks(s).issues.filter((i) => i.check === "length")).toHaveLength(0);
  });
});

// Type-level usage so the test compiles only when KeyEntry carries suppressions.
const _typeProbe: KeyEntry = {
  values: {},
  suppressions: [{ rule: "spelling", locale: "fr", source: "abc", at: "2026-01-01T00:00:00.000Z" }],
};
void _typeProbe;
