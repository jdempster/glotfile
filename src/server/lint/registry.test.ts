import { describe, it, expect } from "vitest";
import { RULE_IDS, DEFAULT_SEVERITY, unknownRuleIds, suggestRuleId } from "./registry.js";

describe("lint registry", () => {
  it("lists exactly the v1 rule ids", () => {
    expect([...RULE_IDS].sort()).toEqual([
      "empty-source",
      "empty-translation",
      "glossary-violation",
      "icu-mismatch",
      "identical-to-source",
      "max-length",
      "placeholder-mismatch",
      "spelling",
      "whitespace",
    ]);
  });
  it("has a default severity for every rule id", () => {
    for (const id of RULE_IDS) expect(["error", "warn"]).toContain(DEFAULT_SEVERITY[id]);
  });
  it("defaults correctness rules to error and advisory rules to warn", () => {
    expect(DEFAULT_SEVERITY["placeholder-mismatch"]).toBe("error");
    expect(DEFAULT_SEVERITY["empty-translation"]).toBe("error");
    expect(DEFAULT_SEVERITY["glossary-violation"]).toBe("error");
    expect(DEFAULT_SEVERITY["spelling"]).toBe("warn");
    expect(DEFAULT_SEVERITY["max-length"]).toBe("warn");
  });
});

describe("unknownRuleIds", () => {
  it("returns only the ids that aren't real rules", () => {
    expect(unknownRuleIds(["glossary", "placeholder-mismatch", "typo"])).toEqual(["glossary", "typo"]);
  });
  it("returns empty when every id is valid", () => {
    expect(unknownRuleIds(["spelling", "max-length"])).toEqual([]);
  });
});

describe("suggestRuleId", () => {
  it("maps a short or partial id to the real rule", () => {
    expect(suggestRuleId("glossary")).toBe("glossary-violation");
    expect(suggestRuleId("placeholder")).toBe("placeholder-mismatch");
    expect(suggestRuleId("spell")).toBe("spelling");
  });
  it("returns undefined when nothing is close", () => {
    expect(suggestRuleId("zzz")).toBeUndefined();
  });
});
