import type { CheckId, Issue, KeyEntry, State } from "./types.js";

export type StateFacet = "missing" | "machine" | "reviewed" | "needs-review";
export type PluralityFacet = "plural" | "single";

export interface KeyFilter {
  text: string;
  states: StateFacet[];
  issues: CheckId[];
  // Plural vs Single facet: OR within the group, AND with the other groups; empty = no constraint.
  plurality: PluralityFacet[];
  tag: string;
  // "Needs attention" — any key with at least one issue (untranslated counts as an issue).
  needsAttention: boolean;
  // Show only keys whose source-locale value is blank or absent.
  emptySource: boolean;
  // When set, state facets and issue facets are scoped to this one locale.
  locale?: string;
  // Show only keys whose context was AI-generated and not yet manually reviewed.
  aiContextUnreviewed: boolean;
  // Show only keys with no code references in the last scan (the `usedKeys` set
  // passed to filterKeys). Conservative: keys matched only by a dynamic prefix
  // are in that set and so are treated as used.
  noUsages: boolean;
  // Show only keys flagged skip-translate (excluded from AI translation and from
  // coverage/untranslated reporting).
  skipTranslate: boolean;
}

// A locale has no usable value for a key (no record, or blank scalar/plural-other).
function isMissing(entry: KeyEntry, locale: string): boolean {
  const lv = entry.values[locale];
  if (!lv) return true;
  return entry.plural
    ? (lv.forms?.other ?? "").trim() === ""
    : (lv.value ?? "").trim() === "";
}

function matchesState(state: State, entry: KeyEntry, facet: StateFacet, locale?: string): boolean {
  if (facet === "missing") {
    if (locale) return isMissing(entry, locale);
    return state.config.locales.some((l) => l !== state.config.sourceLocale && isMissing(entry, l));
  }
  if (locale) return entry.values[locale]?.state === facet;
  return Object.values(entry.values).some((v) => v.state === facet);
}

// A search query starting with "^" is treated as a regular expression anchored
// at the start of the KEY name (case-insensitive): `^auth\.` finds everything
// under the `auth.` prefix. The leading "^" is both the trigger and the anchor,
// matching grep-style intuition; the whole query compiles as a regex, so `$`,
// alternation, and character classes work too. An invalid/half-typed pattern
// compiles to null and matches nothing, so the list empties instead of throwing.
function compileKeyRegex(query: string): RegExp | null {
  try {
    return new RegExp(query, "i");
  } catch {
    return null;
  }
}

export function filterKeys(state: State, filter: KeyFilter, issuesByKey?: Map<string, Issue[]>, usedKeys?: Set<string>): string[] {
  const query = filter.text.trim();
  // Pick the text-match mode once, not per key:
  //   "home.title"  → exact whole-key match
  //   ^auth\.       → regex on the key name
  //   anything else → case-insensitive substring over key/context/tags/values
  const exactKey = query.length >= 2 && query.startsWith('"') && query.endsWith('"')
    ? query.slice(1, -1).toLowerCase()
    : null;
  const keyRegex = exactKey === null && query.startsWith("^") ? compileKeyRegex(query) : null;
  const needle = query.toLowerCase();

  return Object.keys(state.keys).sort().filter((key) => {
    const entry = state.keys[key]!;
    if (filter.tag && !(entry.tags ?? []).includes(filter.tag)) return false;

    if (filter.needsAttention && (issuesByKey?.get(key)?.length ?? 0) === 0) return false;
    if (filter.aiContextUnreviewed && entry.contextSource !== "ai") return false;
    if (filter.emptySource && !isMissing(entry, state.config.sourceLocale)) return false;
    if (filter.noUsages && usedKeys && usedKeys.has(key)) return false;
    if (filter.skipTranslate && !entry.skipTranslate) return false;

    if (filter.plurality?.length) {
      const kind: PluralityFacet = entry.plural ? "plural" : "single";
      if (!filter.plurality.includes(kind)) return false;
    }

    if (filter.states.length && !filter.states.some((s) => matchesState(state, entry, s, filter.locale))) {
      return false;
    }

    if (filter.issues.length) {
      const relevant = (issuesByKey?.get(key) ?? []).filter((i) => !filter.locale || i.locale === filter.locale);
      const checks = new Set(relevant.map((i) => i.check));
      if (!filter.issues.some((c) => checks.has(c))) return false;
    }

    if (query) {
      // "home.title" → exact whole-key match (jump to a single key).
      if (exactKey !== null) {
        if (key.toLowerCase() !== exactKey) return false;
      // ^auth\. → regex on the key name only; invalid pattern matches nothing.
      } else if (query.startsWith("^")) {
        if (!keyRegex || !keyRegex.test(key)) return false;
      // otherwise → case-insensitive substring over key/context/tags/values.
      } else {
        const hay = (key + " " + (entry.context ?? "") + " " + (entry.tags ?? []).join(" ") + " " +
          Object.values(entry.values).map((v) => v.value).join(" ")).toLowerCase();
        if (!hay.includes(needle)) return false;
      }
    }
    return true;
  });
}
