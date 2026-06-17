import { describe, it, expect, afterEach } from "vitest";
import { glossarySuggestEnabled, betaFeatures } from "./beta.js";

const VAR = "GLOTFILE_BETA_GLOSSARY_SUGGEST";

describe("beta flags", () => {
  afterEach(() => { delete process.env[VAR]; });

  it("is off when the env var is unset", () => {
    delete process.env[VAR];
    expect(glossarySuggestEnabled()).toBe(false);
    expect(betaFeatures()).toEqual({ glossarySuggest: false });
  });

  it("treats empty / 0 / false as off", () => {
    for (const v of ["", "0", "false"]) {
      process.env[VAR] = v;
      expect(glossarySuggestEnabled()).toBe(false);
    }
  });

  it("treats any other non-empty value as on", () => {
    for (const v of ["1", "true", "yes", "on"]) {
      process.env[VAR] = v;
      expect(glossarySuggestEnabled()).toBe(true);
    }
    process.env[VAR] = "1";
    expect(betaFeatures()).toEqual({ glossarySuggest: true });
  });
});
