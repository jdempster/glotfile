import { describe, it, expect } from "vitest";
import { flattenObject } from "./flatten.js";

describe("flattenObject", () => {
  it("flattens nested objects to dot-notation", () => {
    const result = flattenObject({ auth: { signIn: "Sign in" } }, "", []);
    expect(result).toEqual({ "auth.signIn": "Sign in" });
  });

  it("coerces numbers and booleans to strings", () => {
    const result = flattenObject({ count: 5, flag: true }, "", []);
    expect(result).toEqual({ count: "5", flag: "true" });
  });

  it("flattens arrays with index keys", () => {
    const result = flattenObject({ items: ["a", "b"] }, "", []);
    expect(result).toEqual({ "items.0": "a", "items.1": "b" });
  });

  it("pushes a warning for null/undefined values and skips them", () => {
    const warnings: string[] = [];
    const result = flattenObject({ a: null }, "", warnings);
    expect(result).toEqual({});
    expect(warnings).toHaveLength(1);
  });

  it("warns when two paths collapse to the same flat key instead of silently overwriting", () => {
    const warnings: string[] = [];
    // A literal dotted key and a nested path both flatten to "a.b".
    flattenObject({ a: { b: "nested" }, "a.b": "literal" }, "", warnings);
    expect(warnings.some((w) => w.includes("a.b"))).toBe(true);
  });
});
