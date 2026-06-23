import { describe, it, expect, vi } from "vitest";
import { indexIssuesByKey, ALL_CHECKS, ALL_STATES, STATE_LABELS, DEFAULT_ENABLED } from "./checks.js";
import { fetchChecks } from "./api.js";
import type { Issue } from "./types.js";

const issues: Issue[] = [
  { key: "a", locale: "fr", check: "placeholder", message: "x" },
  { key: "a", locale: "de", check: "spelling", message: "y" },
  { key: "b", locale: "fr", check: "untranslated", message: "z" },
];

describe("indexIssuesByKey", () => {
  it("groups issues by key", () => {
    const m = indexIssuesByKey(issues);
    expect(m.get("a")).toHaveLength(2);
    expect(m.get("b")).toHaveLength(1);
    expect(m.get("c")).toBeUndefined();
  });
});

describe("check constants", () => {
  it("DEFAULT_ENABLED is the cheap checks (spelling opt-in) and includes untranslated", () => {
    expect(DEFAULT_ENABLED).toEqual(["untranslated", "placeholder", "length", "glossary", "icu", "whitespace", "identical"]);
    expect(ALL_CHECKS).toContain("spelling");
    expect(ALL_CHECKS).not.toContain("empty");
  });
});

describe("state facets", () => {
  it("'missing' is a filterable state facet (analytics drills into it)", () => {
    expect(ALL_STATES).toContain("missing");
  });
  it("every state facet has a label, so filter chips/menu never render blank", () => {
    for (const s of ALL_STATES) expect(STATE_LABELS[s]).toBeTruthy();
  });
});

describe("fetchChecks", () => {
  it("short-circuits on an empty check set without calling the API", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    try {
      const res = await fetchChecks([]);
      expect(res).toEqual({ issues: [], spellPending: false });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
