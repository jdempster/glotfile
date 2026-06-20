import { describe, it, expect } from "vitest";
import { nextRowIndex, scrollAlignForRow } from "./keyNav.js";

describe("nextRowIndex", () => {
  // List of 10 rows; viewport currently shows rows 3..6.
  const visible = [3, 4, 5, 6];

  it("steps down by one when the selection is visible", () => {
    expect(nextRowIndex({ down: true, cur: 4, visible, count: 10 })).toBe(5);
  });

  it("steps up by one when the selection is visible", () => {
    expect(nextRowIndex({ down: false, cur: 4, visible, count: 10 })).toBe(3);
  });

  it("clamps at the last row going down", () => {
    expect(nextRowIndex({ down: true, cur: 9, visible: [9], count: 10 })).toBe(9);
  });

  it("clamps at the first row going up", () => {
    expect(nextRowIndex({ down: false, cur: 0, visible: [0], count: 10 })).toBe(0);
  });

  it("resumes from the top of the viewport when the selection scrolled out of view (Down)", () => {
    // Selection (row 0) is above the viewport; Down should pick the top visible
    // row, not row 1.
    expect(nextRowIndex({ down: true, cur: 0, visible, count: 10 })).toBe(3);
  });

  it("resumes from the bottom of the viewport when the selection scrolled out of view (Up)", () => {
    // Selection (row 9) is below the viewport; Up should pick the bottom visible
    // row, not row 8.
    expect(nextRowIndex({ down: false, cur: 9, visible, count: 10 })).toBe(6);
  });

  it("starts from the top of the viewport with no selection (Down)", () => {
    expect(nextRowIndex({ down: true, cur: -1, visible, count: 10 })).toBe(3);
  });

  it("starts from the bottom of the viewport with no selection (Up)", () => {
    expect(nextRowIndex({ down: false, cur: -1, visible, count: 10 })).toBe(6);
  });

  it("falls back to the first/last row when no viewport info is available", () => {
    expect(nextRowIndex({ down: true, cur: -1, visible: [], count: 10 })).toBe(0);
    expect(nextRowIndex({ down: false, cur: -1, visible: [], count: 10 })).toBe(9);
  });

  it("returns -1 for an empty list", () => {
    expect(nextRowIndex({ down: true, cur: -1, visible: [], count: 0 })).toBe(-1);
  });
});

describe("scrollAlignForRow", () => {
  // Viewport: 200px..900px (scrollTop 200, clientHeight 700).
  const view = { scrollTop: 200, viewport: 700 };

  it("leaves a fully-visible row alone", () => {
    expect(scrollAlignForRow({ start: 300, size: 100, ...view })).toBe(null);
  });

  it("top-aligns a row below the viewport", () => {
    expect(scrollAlignForRow({ start: 1000, size: 100, ...view })).toBe("start");
  });

  it("top-aligns a row above the viewport", () => {
    expect(scrollAlignForRow({ start: 50, size: 100, ...view })).toBe("start");
  });

  it("top-aligns a row partially clipped at the bottom edge", () => {
    // start visible, but its bottom (start+size) spills past the viewport bottom.
    expect(scrollAlignForRow({ start: 850, size: 200, ...view })).toBe("start");
  });

  it("top-aligns a row taller than the viewport instead of showing its bottom", () => {
    // The regression: a 1070px row in a 732px viewport can never be fully
    // visible. "auto" used to resolve to the bottom edge and scroll past the
    // row's top; we always anchor its top so the key name stays on screen.
    expect(scrollAlignForRow({ start: 0, size: 1070, scrollTop: 0, viewport: 732 })).toBe("start");
  });
});
