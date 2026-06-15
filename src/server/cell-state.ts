import type { KeyEntry } from "./schema.js";
import { categoriesFor } from "./plurals.js";

// The actionable state of one (key, locale) cell, from a translator's point of
// view. "missing" means there is nothing usable yet: a blank scalar value, or —
// for a plural — any required CLDR category for that locale left empty. The other
// four mirror LocaleState. This is the single source of truth shared by
// selectRequests (what `translate` picks up) and `get`/extraction, so a
// `--state missing` filter means the same thing everywhere.
export type EffectiveState = "source" | "missing" | "machine" | "needs-review" | "reviewed";

export const EFFECTIVE_STATES: readonly EffectiveState[] = ["source", "missing", "machine", "needs-review", "reviewed"];

export function cellState(entry: KeyEntry, locale: string, sourceLocale: string): EffectiveState {
  const lv = entry.values[locale];
  if (locale === sourceLocale) {
    // The source defines the message's branches; presence hinges on the
    // representative `other` form (matching selectRequests' source-side test).
    const has = entry.plural ? !!lv?.forms?.other?.trim() : !!lv?.value?.trim();
    return has ? "source" : "missing";
  }
  const present = entry.plural
    ? categoriesFor(locale).every((c) => (lv?.forms?.[c] ?? "") !== "")
    : !!lv?.value;
  if (!present) return "missing";
  const st = lv!.state;
  return st === "reviewed" ? "reviewed" : st === "needs-review" ? "needs-review" : "machine";
}
