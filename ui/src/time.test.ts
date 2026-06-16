import { describe, it, expect } from "vitest";
import { timeAgo } from "./time.js";

describe("timeAgo", () => {
  const now = new Date("2026-06-16T12:00:00Z").getTime();

  it("renders 'just now' under a minute", () => {
    expect(timeAgo("2026-06-16T11:59:30Z", now)).toBe("just now");
  });

  it("renders whole minutes", () => {
    expect(timeAgo("2026-06-16T11:55:00Z", now)).toBe("5m ago");
  });

  it("renders whole hours", () => {
    expect(timeAgo("2026-06-16T10:00:00Z", now)).toBe("2h ago");
  });

  it("renders whole days", () => {
    expect(timeAgo("2026-06-13T12:00:00Z", now)).toBe("3d ago");
  });

  it("treats future timestamps as 'just now'", () => {
    expect(timeAgo("2026-06-16T12:05:00Z", now)).toBe("just now");
  });

  it("returns an empty string for invalid input", () => {
    expect(timeAgo("not-a-date", now)).toBe("");
  });
});
