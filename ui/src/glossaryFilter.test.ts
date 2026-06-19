import { describe, expect, test } from "vitest";
import { filterGlossary } from "./glossaryFilter.js";
import type { GlossaryEntry } from "./types.js";

const entries: GlossaryEntry[] = [
  {
    term: "Sprout",
    doNotTranslate: true,
    notes: "Brand name. Never translate.",
  },
  {
    term: "Feed",
    aliases: ["feeding", "feeds"],
    notes: "Fertilizer for a plant, not a content feed.",
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
    expect(filterGlossary(entries, "spro")).toEqual([entries[0]]);
  });

  test("matches notes", () => {
    expect(filterGlossary(entries, "fertilizer")).toEqual([entries[1]]);
  });

  test("matches aliases", () => {
    expect(filterGlossary(entries, "feeding")).toEqual([entries[1]]);
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
