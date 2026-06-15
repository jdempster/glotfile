import { describe, it, expect } from "vitest";
import { locate } from "./locate.js";

const raw = [
  "{",
  '  "keys": {',
  '    "auth.signIn": { "values": {} },',
  '    "auth.signIn.button": { "values": {} }',
  "  }",
  "}",
].join("\n");

describe("locate", () => {
  it("finds the line of an exact key, not a prefix collision", () => {
    expect(locate(raw, "auth.signIn.button").line).toBe(4);
  });
  it("finds the earlier key correctly", () => {
    expect(locate(raw, "auth.signIn").line).toBe(3);
  });
  it("falls back to line 1 for an unknown key", () => {
    expect(locate(raw, "nope")).toEqual({ line: 1, column: 1 });
  });
});
