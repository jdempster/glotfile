import { describe, it, expect } from "vitest";
import { runLint, sortFindings, countSeverities } from "./run.js";
import type { Finding } from "./types.js";
import type { State, LintConfig } from "../schema.js";

function state(lint?: LintConfig): State {
  return {
    version: 1,
    config: {
      sourceLocale: "en", locales: ["en", "fr"], outputs: [],
      format: { indent: 2, sortKeys: true, finalNewline: true },
      lint,
    },
    glossary: [],
    glossarySuggestions: [],
    keys: {
      "a.key": { values: { en: { value: "OK", state: "source" }, fr: { value: "OK", state: "reviewed" } } },
      "b.key": { values: { en: { value: "Hi {n}", state: "source" }, fr: { value: "Salut", state: "reviewed" } } },
      "c.key": { values: { en: { value: "Bye", state: "source" } } },
    },
  };
}

const quiet = { warn: () => {} };

describe("runLint", () => {
  it("reports findings sorted by (key, locale, ruleId) and counts severities", async () => {
    const r = await runLint(state(), { loadSpeller: async () => null, ...quiet });
    expect(r.findings[0]).toMatchObject({ key: "a.key", ruleId: "identical-to-source", severity: "warn" });
    expect(r.findings.some((f) => f.key === "c.key" && f.ruleId === "empty-translation")).toBe(true);
    expect(r.findings.some((f) => f.key === "b.key" && f.ruleId === "placeholder-mismatch")).toBe(true);
    expect(r.counts.error).toBe(2);
    expect(r.ok).toBe(false);
  });

  it("respects severity overrides and 'off'", async () => {
    const r = await runLint(state({ rules: { "empty-translation": "off", "placeholder-mismatch": "warn" } }),
      { loadSpeller: async () => null, ...quiet });
    expect(r.findings.some((f) => f.ruleId === "empty-translation")).toBe(false);
    expect(r.findings.find((f) => f.ruleId === "placeholder-mismatch")?.severity).toBe("warn");
  });

  it("drops findings for ignored key globs", async () => {
    const r = await runLint(state({ ignore: ["b.*"] }), { loadSpeller: async () => null, ...quiet });
    expect(r.findings.every((f) => f.key !== "b.key")).toBe(true);
  });

  it("restricts to a --rule subset", async () => {
    const r = await runLint(state(), { ruleIds: ["identical-to-source"], loadSpeller: async () => null, ...quiet });
    expect(r.findings.every((f) => f.ruleId === "identical-to-source")).toBe(true);
  });

  it("does not load a speller when spelling is off", async () => {
    let called = false;
    await runLint(state({ rules: { spelling: "off" } }),
      { loadSpeller: async () => { called = true; return null; }, ...quiet });
    expect(called).toBe(false);
  });
});

describe("sortFindings / countSeverities", () => {
  it("sorts and counts", () => {
    const fs: Finding[] = [
      { ruleId: "z", key: "b", locale: "", severity: "warn", message: "" },
      { ruleId: "a", key: "b", locale: "", severity: "error", message: "" },
    ];
    expect(sortFindings(fs)[0]!.ruleId).toBe("a");
    expect(countSeverities(fs)).toEqual({ error: 1, warn: 1 });
  });
});
