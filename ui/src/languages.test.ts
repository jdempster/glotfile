import { describe, it, expect } from "vitest";
import { resolveLanguage, isRtl } from "./languages.js";

describe("resolveLanguage", () => {
  it("resolves a bare language code", () => {
    const r = resolveLanguage("en");
    expect(r.isCustom).toBe(false);
    expect(r.bcp47).toBe("en");
    expect(r.name).toContain("English");
    // Region-less English maps to the combined UK/US flag, not maximize()'s "US".
    expect(r.flagRegion).toBe("en");
  });

  it("resolves region subtags (underscore separator must not throw)", () => {
    expect(() => resolveLanguage("en_US")).not.toThrow();
    const us = resolveLanguage("en_US");
    expect(us.bcp47).toBe("en-US");
    expect(us.name).toContain("American");
    expect(us.flagRegion).toBe("US");

    const gb = resolveLanguage("en_GB");
    expect(gb.name).toContain("British");
    expect(gb.flagRegion).toBe("GB");
  });

  it("resolves a non-default language+region (Catalan in Spain)", () => {
    const r = resolveLanguage("ca_ES");
    expect(r.isCustom).toBe(false);
    expect(r.name).toContain("Catalan");
    expect(r.flagRegion).toBe("ES");
  });

  it("resolves region and script subtags via maximize()", () => {
    expect(resolveLanguage("zh_HK").flagRegion).toBe("HK");
    const hant = resolveLanguage("zh_Hant");
    expect(hant.name).toContain("Traditional");
    expect(hant.flagRegion).toBe("TW"); // maximize() infers a region from the script
  });

  it("marks an unresolvable code as custom and falls back to the code", () => {
    const r = resolveLanguage("en_PIRATE");
    expect(r.isCustom).toBe(true);
    expect(r.name).toBe("en_PIRATE");
    expect(r.flagRegion).toBe(null);
  });

  it("honours overrides, distinguishing flag:null from absent", () => {
    expect(resolveLanguage("en", { flag: "gb" }).flagRegion).toBe("gb");
    expect(resolveLanguage("en", { flag: null }).flagRegion).toBe(null);
    expect(resolveLanguage("en", {}).flagRegion).toBe("en"); // absent flag → auto-derive (combined flag)

    const pirate = resolveLanguage("en_PIRATE", { name: "Pirate English", flag: "gb" });
    expect(pirate.name).toBe("Pirate English");
    expect(pirate.flagRegion).toBe("gb");
  });

  it("passes the code through verbatim and exposes the endonym", () => {
    expect(resolveLanguage("en_US").code).toBe("en_US"); // verbatim, not normalised
    expect(resolveLanguage("fr").endonym).toBe("français");
    expect(resolveLanguage("en_PIRATE").endonym).toBeUndefined();
  });

  it("flags right-to-left languages (helper + resolved field)", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("ar_EG")).toBe(true);
    expect(isRtl("en")).toBe(false);
    expect(resolveLanguage("ar").rtl).toBe(true);
    expect(resolveLanguage("en_US").rtl).toBe(false);
  });
});
