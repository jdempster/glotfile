import { describe, it, expect } from "vitest";
import { globToRegExp } from "./glob.js";

describe("globToRegExp", () => {
  it("matches a '*' wildcard against any run of characters", () => {
    expect(globToRegExp("auth.*").test("auth.signIn.button")).toBe(true);
    expect(globToRegExp("auth.*").test("billing.plan")).toBe(false);
  });
  it("anchors the whole string", () => {
    expect(globToRegExp("auth").test("auth.signIn")).toBe(false);
    expect(globToRegExp("auth").test("auth")).toBe(true);
  });
  it("escapes regex metacharacters in the literal parts", () => {
    expect(globToRegExp("a.b").test("axb")).toBe(false);
    expect(globToRegExp("a.b").test("a.b")).toBe(true);
  });
});
