import { describe, it, expect } from "vitest";
import { usePager } from "./usePager.js";

describe("usePager", () => {
  it("caps the window to the page size and reveals a page at a time", () => {
    const arr = Array.from({ length: 130 }, (_, i) => i);
    const p = usePager(50);

    expect(p.slice("x", arr)).toHaveLength(50);
    expect(p.remaining("x", arr)).toBe(80);

    p.more("x");
    expect(p.slice("x", arr)).toHaveLength(100);
    expect(p.remaining("x", arr)).toBe(30);

    p.more("x");
    expect(p.slice("x", arr)).toHaveLength(130);
    expect(p.remaining("x", arr)).toBe(0);
  });

  it("tracks each key's window independently", () => {
    const a = Array.from({ length: 80 }, (_, i) => i);
    const b = Array.from({ length: 80 }, (_, i) => i);
    const p = usePager(50);

    p.more("a");
    expect(p.slice("a", a)).toHaveLength(80);
    expect(p.slice("b", b)).toHaveLength(50);
  });

  it("handles lists shorter than a page", () => {
    const p = usePager(50);
    const arr = [1, 2, 3];
    expect(p.slice("x", arr)).toHaveLength(3);
    expect(p.remaining("x", arr)).toBe(0);
  });
});
