import { describe, it, expect } from "vitest";
import { nextRowIndex } from "./keyNav.js";

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
