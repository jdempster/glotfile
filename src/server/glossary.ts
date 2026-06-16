import type { GlossaryEntry, State } from "./schema.js";
import type { GlossaryHint } from "./ai/provider.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contains(haystack: string, needle: string, caseSensitive?: boolean, wholeWord?: boolean): boolean {
  if (!wholeWord) {
    return caseSensitive
      ? haystack.includes(needle)
      : haystack.toLowerCase().includes(needle.toLowerCase());
  }
  // Whole-word match: the term must not be flanked by a letter or digit. Uses
  // Unicode property escapes (not \b, which is ASCII-only) so adjacent
  // accented/CJK letters correctly count as part of the word.
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, caseSensitive ? "u" : "iu");
  return re.test(haystack);
}

// Whether a term applies to a piece of source text. A glossary term denotes a
// word, not a character sequence, so matching is whole-word by default — "Pro"
// applies to "Pro plan" but not "Process". Set wholeWord: false to fall back to
// substring matching (e.g. to match a term inside a compound source word).
function termInSource(source: string, entry: GlossaryEntry): boolean {
  return contains(source, entry.term, entry.caseSensitive, entry.wholeWord ?? true);
}

// Glossary entries whose term appears in the source text, shaped as hints for
// the AI translation prompt.
export function relevantGlossary(source: string, targetLocale: string, glossary: GlossaryEntry[]): GlossaryHint[] {
  const hints: GlossaryHint[] = [];
  for (const entry of glossary) {
    if (!termInSource(source, entry)) continue;
    hints.push({
      term: entry.term,
      doNotTranslate: entry.doNotTranslate,
      forced: entry.translations?.[targetLocale],
      notes: entry.notes,
    });
  }
  return hints;
}

export interface GlossaryViolation {
  term: string;
  // The text the translation must contain: the term itself for a
  // do-not-translate entry, or the forced target-locale translation.
  expected: string;
  kind: "do-not-translate" | "forced";
}

// Keys whose source value contains `term`, using the same whole-word/case rules
// as glossary matching. Powers the occurrence count shown next to a suggestion.
export function sourceKeysForTerm(
  state: State,
  term: string,
  opts: { caseSensitive?: boolean; wholeWord?: boolean } = {},
): string[] {
  const pseudo = { term, caseSensitive: opts.caseSensitive, wholeWord: opts.wholeWord } as GlossaryEntry;
  const out: string[] = [];
  for (const [key, entry] of Object.entries(state.keys)) {
    const lv = entry.values[state.config.sourceLocale];
    const text = lv?.value ?? lv?.forms?.other ?? "";
    if (text && termInSource(text, pseudo)) out.push(key);
  }
  return out;
}

// The single source of truth for glossary enforcement: both the editor's live
// check (checks.ts) and the lint rule (lint/rules.ts) report exactly what this
// returns, so the cockpit's drilldown always lands on visible editor issues.
// A do-not-translate entry takes precedence over a forced translation.
export function glossaryViolations(source: string, value: string, targetLocale: string, glossary: GlossaryEntry[]): GlossaryViolation[] {
  const out: GlossaryViolation[] = [];
  for (const entry of glossary) {
    // Relevance uses whole-word matching (see termInSource), but the check that
    // the translation HONORED the term is always lenient substring: a term is
    // kept even when inflected or compounded ("Webhooks" keeps "Webhook",
    // German "Accounteinstellungen" keeps "Account", Japanese "APIキー" keeps
    // "API"), so legitimate translations are never flagged.
    if (!termInSource(source, entry)) continue;
    if (entry.doNotTranslate) {
      if (!contains(value, entry.term, entry.caseSensitive)) {
        out.push({ term: entry.term, expected: entry.term, kind: "do-not-translate" });
      }
      continue;
    }
    const forced = entry.translations?.[targetLocale];
    if (forced && !contains(value, forced, entry.caseSensitive)) {
      out.push({ term: entry.term, expected: forced, kind: "forced" });
    }
  }
  return out;
}
