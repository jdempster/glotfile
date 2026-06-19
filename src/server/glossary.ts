import type { GlossaryEntry, State } from "./schema.js";
import type { GlossaryHint } from "./ai/provider.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Compiled whole-word, case-insensitive matchers, cached by surface form so the
// same term/alias reused across thousands of keys compiles its regex once.
// Boundaries use Unicode property escapes (not \b, which is ASCII-only) so
// adjacent accented/CJK letters count as part of the word — "Pro" applies to
// "Pro plan" but never to "Process".
const matcherCache = new Map<string, RegExp>();
function matcherFor(surface: string): RegExp {
  let re = matcherCache.get(surface);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(surface)}(?![\\p{L}\\p{N}])`, "iu");
    matcherCache.set(surface, re);
  }
  return re;
}

// Every surface form an entry matches on: the canonical term plus any aliases.
function surfaces(entry: GlossaryEntry): string[] {
  const out = [entry.term];
  for (const a of entry.aliases ?? []) {
    const t = a.trim();
    if (t && t !== entry.term) out.push(t);
  }
  return out;
}

// The surface form (term or alias) that appears as a standalone word in the
// source, or null. Always whole-word + case-insensitive: precision by default,
// widened only by explicit aliases.
function matchedSurface(source: string, entry: GlossaryEntry): string | null {
  for (const s of surfaces(entry)) {
    if (matcherFor(s).test(source)) return s;
  }
  return null;
}

export interface GlossaryMatch {
  entry: GlossaryEntry;
  // Whether the CANONICAL term (not just an alias) appeared. A forced
  // translation is only injected/enforced on a canonical match: an alias is an
  // inflected source form whose target rendering legitimately differs from the
  // pinned word, so forcing the exact string there would mis-flag good work.
  canonical: boolean;
}

// Glossary entries that apply to a piece of source text. Relevance does NOT
// depend on the target locale — only the per-locale hint shaping does — so this
// is computed ONCE per source string and reused across every target locale.
export function matchGlossary(source: string, glossary: GlossaryEntry[]): GlossaryMatch[] {
  const out: GlossaryMatch[] = [];
  for (const entry of glossary) {
    const surface = matchedSurface(source, entry);
    if (surface === null) continue;
    out.push({ entry, canonical: surface === entry.term });
  }
  return out;
}

// Plural keys translate every source FORM, so a term is relevant if it appears
// in ANY form. Joining with a newline (a non-word char) keeps word boundaries
// intact across forms while matching them all in one pass.
export function matchGlossaryForms(forms: Iterable<string>, glossary: GlossaryEntry[]): GlossaryMatch[] {
  return matchGlossary([...forms].join("\n"), glossary);
}

// Shape matches into per-locale hints for the translation prompt. A
// do-not-translate term never carries a forced translation (the two are
// mutually exclusive — DNT wins); a forced translation rides along only on a
// canonical-term match.
export function glossaryHints(matches: GlossaryMatch[], targetLocale: string): GlossaryHint[] {
  return matches.map(({ entry, canonical }) => ({
    term: entry.term,
    doNotTranslate: entry.doNotTranslate,
    forced: entry.doNotTranslate || !canonical ? undefined : entry.translations?.[targetLocale],
    notes: entry.notes,
  }));
}

// Match + shape in one call (the editor / single-cell path).
export function relevantGlossary(source: string, targetLocale: string, glossary: GlossaryEntry[]): GlossaryHint[] {
  return glossaryHints(matchGlossary(source, glossary), targetLocale);
}

export interface GlossaryViolation {
  term: string;
  // The text the translation must contain: the term itself for a
  // do-not-translate entry, or the forced target-locale translation.
  expected: string;
  kind: "do-not-translate" | "forced";
}

// Lenient, case-insensitive containment — the test that a translation HONORED a
// term. Always lenient so inflected/compounded keeps are never flagged
// ("Webhooks" keeps "Webhook", German "Accounteinstellungen" keeps "Account").
function valueContains(value: string, needle: string): boolean {
  return value.toLowerCase().includes(needle.toLowerCase());
}

// Keys whose source value contains `term`, using the same whole-word matching as
// glossary relevance. Powers the occurrence count shown next to a suggestion.
export function sourceKeysForTerm(state: State, term: string): string[] {
  const pseudo = { term } as GlossaryEntry;
  const out: string[] = [];
  for (const [key, entry] of Object.entries(state.keys)) {
    const lv = entry.values[state.config.sourceLocale];
    const text = lv?.value ?? lv?.forms?.other ?? "";
    if (text && matchedSurface(text, pseudo) !== null) out.push(key);
  }
  return out;
}

// The single source of truth for glossary enforcement: both the editor's live
// check (checks.ts) and the lint rule (lint/rules.ts) report exactly what this
// returns, so the cockpit's drilldown always lands on visible editor issues.
export function glossaryViolations(source: string, value: string, targetLocale: string, glossary: GlossaryEntry[]): GlossaryViolation[] {
  const out: GlossaryViolation[] = [];
  for (const { entry, canonical } of matchGlossary(source, glossary)) {
    if (entry.doNotTranslate) {
      // The translation must keep some matched surface (term or the alias that
      // appeared) verbatim. Lenient so inflections aren't flagged.
      if (!surfaces(entry).some((s) => valueContains(value, s))) {
        out.push({ term: entry.term, expected: entry.term, kind: "do-not-translate" });
      }
      continue;
    }
    // Forced enforcement only on a canonical-term match (see GlossaryMatch).
    if (!canonical) continue;
    const forced = entry.translations?.[targetLocale];
    if (forced && !valueContains(value, forced)) {
      out.push({ term: entry.term, expected: forced, kind: "forced" });
    }
  }
  return out;
}
