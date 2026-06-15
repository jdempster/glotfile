import { describe, expect, test } from "vitest";
import { filterGlossary } from "./glossaryFilter.js";
import type { GlossaryEntry } from "./types.js";

const entries: GlossaryEntry[] = [
  {
    term: "Sign In App",
    doNotTranslate: true,
    caseSensitive: true,
    notes: "Brand name. Never translate.",
  },
  {
    term: "Host",
    notes: "The employee a visitor is there to see.",
    translations: { fr: "Hôte", de: "Gastgeber" },
  },
  { term: "Kiosk" },
];

describe("filterGlossary", () => {
  test("empty query returns all entries", () => {
    expect(filterGlossary(entries, "")).toEqual(entries);
  });

  test("whitespace-only query returns all entries", () => {
    expect(filterGlossary(entries, "   ")).toEqual(entries);
  });

  test("matches term case-insensitively", () => {
    expect(filterGlossary(entries, "kiosk")).toEqual([entries[2]]);
  });

  test("matches substring of term", () => {
    expect(filterGlossary(entries, "sign in")).toEqual([entries[0]]);
  });

  test("matches notes", () => {
    expect(filterGlossary(entries, "visitor")).toEqual([entries[1]]);
  });

  test("matches forced translation values", () => {
    expect(filterGlossary(entries, "gastgeber")).toEqual([entries[1]]);
  });

  test("matches forced translation locale codes", () => {
    expect(filterGlossary(entries, "fr")).toEqual([entries[1]]);
  });

  test("returns empty array when nothing matches", () => {
    expect(filterGlossary(entries, "zzz")).toEqual([]);
  });

  test("trims the query before matching", () => {
    expect(filterGlossary(entries, "  kiosk  ")).toEqual([entries[2]]);
  });
});
