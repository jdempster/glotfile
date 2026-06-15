import { describe, it, expect } from "vitest";
import { spellingRule } from "./spelling.js";
import type { LintContext, Speller } from "./types.js";
import type { State } from "../schema.js";

function speller(known: string[]): Speller {
  const set = new Set(known.map((w) => w.toLowerCase()));
  return { correct: (w) => set.has(w.toLowerCase()) };
}

function state(value: string): State {
  return {
    version: 1,
    config: {
      sourceLocale: "en", locales: ["en", "fr"], outputs: [],
      format: { indent: 2, sortKeys: true, finalNewline: true },
    },
    glossary: [],
    keys: { "a": { values: { en: { value: "x", state: "source" }, fr: { value, state: "reviewed" } } } },
  };
}

function ctx(over: Partial<LintContext>): LintContext {
  return {
    config: {}, sourceLocale: "en", targetLocales: ["fr"], glossary: [],
    spellers: new Map(), allowWords: new Set(), ...over,
  };
}

describe("spellingRule", () => {
  it("flags a word not in the dictionary or allow-list", () => {
    const c = ctx({ spellers: new Map([["fr", speller(["bonjour"])]]) });
    expect(spellingRule.run(state("bonjour zzqq"), c)).toEqual([
      { ruleId: "spelling", key: "a", locale: "fr", message: 'possible misspelling: "zzqq"' },
    ]);
  });
  it("skips placeholder names", () => {
    const c = ctx({ spellers: new Map([["fr", speller(["bonjour"])]]) });
    expect(spellingRule.run(state("bonjour {name}"), c)).toEqual([]);
  });
  it("skips ICU plural/select branch text", () => {
    const c = ctx({ spellers: new Map([["fr", speller(["bonjour"])]]) });
    expect(spellingRule.run(state("bonjour {count, plural, one {zzqq} other {zzqqs}}"), c)).toEqual([]);
  });
  it("skips allow-listed words", () => {
    const c = ctx({ spellers: new Map([["fr", speller(["bonjour"])]]), allowWords: new Set(["zzqq"]) });
    expect(spellingRule.run(state("bonjour zzqq"), c)).toEqual([]);
  });
  it("skips a locale with no speller", () => {
    const c = ctx({ spellers: new Map() });
    expect(spellingRule.run(state("zzqq"), c)).toEqual([]);
  });
});
