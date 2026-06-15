import type { KeyEntry } from "./types.js";
import { categoriesFor } from "./plurals.js";


// Browser mirror of the server's selectRequests({ onlyMissing: true }) per-target
// rule (src/server/ai/run.ts): a scalar target is missing when it has no value;
// a plural target is missing when any required CLDR category for that locale is
// empty. A key with no translatable source (scalar value / plural `other`) has
// nothing missing. Checking only the scalar `value` would wrongly flag every
// plural target — whose content lives in `forms` — as missing.
export function isTargetMissing(entry: KeyEntry, locale: string, sourceLocale: string): boolean {
  if (locale === sourceLocale) return false;
  const sourceLv = entry.values[sourceLocale];
  if (entry.plural) {
    if (!sourceLv?.forms?.other) return false;
    const have = entry.values[locale]?.forms ?? {};
    return categoriesFor(locale).some((c) => (have[c] ?? "") === "");
  }
  if (!sourceLv?.value) return false;
  return !entry.values[locale]?.value;
}

export function missingTargetLocales(entry: KeyEntry, locales: string[], sourceLocale: string): string[] {
  return locales.filter((l) => isTargetMissing(entry, l, sourceLocale));
}

export function staleTargetLocales(entry: KeyEntry, locales: string[], sourceLocale: string): string[] {
  return locales.filter((loc) => {
    if (loc === sourceLocale) return false;
    const lv = entry.values[loc];
    if (!lv) return false;
    if (lv.state !== "needs-review") return false;
    return lv.value ? lv.value.length > 0 : Object.keys(lv.forms ?? {}).length > 0;
  });
}
