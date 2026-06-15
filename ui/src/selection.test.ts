import { describe, it, expect } from "vitest";
import { useSelection } from "./selection.js";

describe("useSelection", () => {
  it("toggles a key on and off and tracks count", () => {
    const s = useSelection();
    expect(s.has("a")).toBe(false);
    s.toggle("a");
    expect(s.has("a")).toBe(true);
    expect(s.count.value).toBe(1);
    s.toggle("a");
    expect(s.has("a")).toBe(false);
    expect(s.count.value).toBe(0);
  });

  it("selectAll adds every key; clear empties", () => {
    const s = useSelection();
    s.selectAll(["a", "b", "c"]);
    expect(s.count.value).toBe(3);
    expect(s.allSelected(["a", "b", "c"])).toBe(true);
    s.clear();
    expect(s.count.value).toBe(0);
  });

  it("toggleRange selects the contiguous range from the anchor (shift-click)", () => {
    const s = useSelection();
    const rows = ["a", "b", "c", "d", "e"];
    s.toggle("b"); // anchor = b
    s.toggleRange("d", rows); // selects b..d
    expect(s.keys().sort()).toEqual(["b", "c", "d"]);
  });

  it("toggleRange with no anchor behaves like a plain toggle", () => {
    const s = useSelection();
    s.toggleRange("c", ["a", "b", "c"]);
    expect(s.keys()).toEqual(["c"]);
  });

  it("pruneTo drops keys no longer in the filtered set", () => {
    const s = useSelection();
    s.selectAll(["a", "b", "c"]);
    s.pruneTo(["a", "c"]);
    expect(s.keys().sort()).toEqual(["a", "c"]);
  });

  it("allSelected needs all; someSelected needs at least one", () => {
    const s = useSelection();
    s.toggle("a");
    expect(s.someSelected(["a", "b"])).toBe(true);
    expect(s.allSelected(["a", "b"])).toBe(false);
    s.toggle("b");
    expect(s.allSelected(["a", "b"])).toBe(true);
  });

  it("toggleRange with stale anchor (not in orderedKeys) falls back to plain toggle", () => {
    const s = useSelection();
    // Toggle "x" so anchor = "x", but "x" is not present in the orderedKeys below.
    s.toggle("x");
    s.toggleRange("c", ["a", "b", "c"]);
    // "x" stays selected; "c" is added as a plain toggle; no range is computed.
    expect(s.keys().sort()).toEqual(["c", "x"]);
  });

  it("toggleRange in descending direction selects the correct range", () => {
    const s = useSelection();
    const rows = ["a", "b", "c", "d", "e"];
    s.toggle("d"); // anchor = "d"
    s.toggleRange("b", rows); // range b..d
    expect(s.keys().sort()).toEqual(["b", "c", "d"]);
  });
});
