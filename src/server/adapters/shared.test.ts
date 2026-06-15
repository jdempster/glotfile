import { describe, it, expect } from "vitest";
import { nestKeys } from "./shared.js";

describe("nestKeys", () => {
  it("nests dot-notation keys into objects", () => {
    const { tree, collisions } = nestKeys({ "a.b.c": "x", "a.b.d": "y", z: "w" });
    expect(tree).toEqual({ a: { b: { c: "x", d: "y" } }, z: "w" });
    expect(collisions).toEqual([]);
  });

  it("records a collision when a key is both a leaf and a parent", () => {
    const { collisions } = nestKeys({ a: "leaf", "a.b": "branch" });
    expect(collisions).toContain("a.b");
  });

  it("records a collision when a parent arrives after its leaf-named sibling", () => {
    const { tree, collisions } = nestKeys({ "a.b": "branch", a: "leaf" });
    expect(collisions).toContain("a");
    expect(tree).toEqual({ a: { b: "branch" } });
  });
});
