import type { PluralCategory } from "./types.js";

// Canonical CLDR category order, mirroring the server's PLURAL_CATEGORIES.
const PLURAL_CATEGORIES: readonly PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

// Browser mirror of the server's categoriesFor: the cardinal plural categories
// valid for a locale per the platform's Intl.PluralRules, re-sorted into our
// canonical order. Unknown/invalid tags degrade to the universal ["other"].
export function categoriesFor(locale: string): PluralCategory[] {
  let reported: readonly string[];
  try {
    // Catalog locale codes use underscores (en_us); Intl needs BCP-47 hyphens.
    reported = new Intl.PluralRules(locale.replace(/_/g, "-"), { type: "cardinal" }).resolvedOptions().pluralCategories;
  } catch {
    reported = ["other"];
  }
  const set = new Set(reported);
  return PLURAL_CATEGORIES.filter((c) => set.has(c));
}
