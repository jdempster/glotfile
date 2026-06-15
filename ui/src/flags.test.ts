import { describe, it, expect } from "vitest";
import { flagUrl } from "./flags.js";

describe("flagUrl", () => {
  it("returns an asset url for a known region (case-insensitive)", () => {
    expect(flagUrl("us")).toMatch(/\.svg/);
    expect(flagUrl("US")).toMatch(/\.svg/);
    expect(flagUrl("gb")).toMatch(/\.svg/);
    // Combined UK/US flag for region-less English.
    expect(flagUrl("en")).toMatch(/\.svg/);
  });

  it("returns undefined for an unknown region", () => {
    expect(flagUrl("zz")).toBeUndefined();
  });
});
