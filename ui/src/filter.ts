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

// Which part of a key the text query searches.
export type SearchScope = "all" | "key" | "value" | "context";
const SCOPES: SearchScope[] = ["key", "value", "context", "all"];

// A compiled, case-insensitive RegExp; an invalid/half-typed pattern returns null
// so the list empties instead of throwing.
function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

// Every translatable string on a key: scalar values and plural `forms` alike,
// across all locales.
function valueText(entry: KeyEntry): string {
  return Object.values(entry.values)
    .flatMap((v) => [v.value, ...Object.values(v.forms ?? {})])
    .filter((s): s is string => !!s)
    .join(" ");
}

function haystack(key: string, entry: KeyEntry, scope: SearchScope): string {
  switch (scope) {
    case "key": return key;
    case "value": return valueText(entry);
    case "context": return entry.context ?? "";
    case "all": return `${key} ${entry.context ?? ""} ${(entry.tags ?? []).join(" ")} ${valueText(entry)}`;
  }
}

export interface ParsedSearch {
  scope: SearchScope;
  // "none" → no text constraint; "invalid-regex" → match nothing (half-typed pattern).
  mode: "none" | "substring" | "regex" | "invalid-regex";
  needle: string;       // lowercased, for substring
  regex: RegExp | null; // for regex
}

// Parse the search box. An optional leading scope prefix (`key:` / `value:` /
// `context:` / `all:`, case-insensitive) chooses which field to search; the rest
// is a case-insensitive substring, or — when wrapped in /…/ — a regular expression.
// No prefix searches everything; an unrecognised prefix is treated literally.
export function parseSearch(text: string): ParsedSearch {
  let scope: SearchScope = "all";
  let rest = text.trim();
  const lower = rest.toLowerCase();
  for (const s of SCOPES) {
    if (lower.startsWith(`${s}:`)) { scope = s; rest = rest.slice(s.length + 1).trim(); break; }
  }
  if (rest === "") return { scope, mode: "none", needle: "", regex: null };
  if (rest.length >= 2 && rest.startsWith("/") && rest.endsWith("/")) {
    const regex = compileRegex(rest.slice(1, -1));
    return { scope, mode: regex ? "regex" : "invalid-regex", needle: "", regex };
  }
  return { scope, mode: "substring", needle: rest.toLowerCase(), regex: null };
}

function matchesText(key: string, entry: KeyEntry, q: ParsedSearch): boolean {
  switch (q.mode) {
    case "none": return true;
    case "invalid-regex": return false;
    case "regex": return q.regex!.test(haystack(key, entry, q.scope));
    case "substring": return haystack(key, entry, q.scope).toLowerCase().includes(q.needle);
  }
}

export function filterKeys(state: State, filter: KeyFilter, issuesByKey?: Map<string, Issue[]>, usedKeys?: Set<string>): string[] {
  // Parse the text query once, not per key.
  const search = filter.text.trim() ? parseSearch(filter.text) : null;

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

    if (search && !matchesText(key, entry, search)) return false;
    return true;
  });
}
