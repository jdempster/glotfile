import { describe, it, expect } from "vitest";
import { cellState } from "./cell-state.js";
import type { KeyEntry } from "./schema.js";

const scalar = (values: KeyEntry["values"]): KeyEntry => ({ values });
const plural = (values: KeyEntry["values"]): KeyEntry => ({ plural: { arg: "count" }, values });

describe("cellState", () => {
  it("classifies the source locale as source (or missing when blank)", () => {
    expect(cellState(scalar({ en: { value: "Hi", state: "source" } }), "en", "en")).toBe("source");
    expect(cellState(scalar({ en: { value: "  ", state: "source" } }), "en", "en")).toBe("missing");
    expect(cellState(scalar({}), "en", "en")).toBe("missing");
  });

  it("classifies a scalar target by presence then stored state", () => {
    expect(cellState(scalar({ en: { value: "Hi", state: "source" } }), "fr", "en")).toBe("missing");
    expect(cellState(scalar({ fr: { value: "Salut", state: "machine" } }), "fr", "en")).toBe("machine");
    expect(cellState(scalar({ fr: { value: "Salut", state: "needs-review" } }), "fr", "en")).toBe("needs-review");
    expect(cellState(scalar({ fr: { value: "Salut", state: "reviewed" } }), "fr", "en")).toBe("reviewed");
  });

  it("treats a plural target as missing until every required category for the locale is filled", () => {
    // pl requires one/few/many/other — only `one` present ⇒ still missing.
    const partial = plural({ pl: { forms: { one: "x" }, state: "machine" } });
    expect(cellState(partial, "pl", "en")).toBe("missing");
    const complete = plural({ pl: { forms: { one: "a", few: "b", many: "c", other: "d" }, state: "machine" } });
    expect(cellState(complete, "pl", "en")).toBe("machine");
  });
});
