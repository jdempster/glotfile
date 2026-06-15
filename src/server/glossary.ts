import type { GlossaryEntry } from "./schema.js";
import type { GlossaryHint } from "./ai/provider.js";

function contains(haystack: string, needle: string, caseSensitive?: boolean): boolean {
  return caseSensitive
    ? haystack.includes(needle)
    : haystack.toLowerCase().includes(needle.toLowerCase());
}

// Glossary entries whose term appears in the source text, shaped as hints for
// the AI translation prompt.
export function relevantGlossary(source: string, targetLocale: string, glossary: GlossaryEntry[]): GlossaryHint[] {
  const hints: GlossaryHint[] = [];
  for (const entry of glossary) {
    if (!contains(source, entry.term, entry.caseSensitive)) continue;
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

// The single source of truth for glossary enforcement: both the editor's live
// check (checks.ts) and the lint rule (lint/rules.ts) report exactly what this
// returns, so the cockpit's drilldown always lands on visible editor issues.
// A do-not-translate entry takes precedence over a forced translation.
export function glossaryViolations(source: string, value: string, targetLocale: string, glossary: GlossaryEntry[]): GlossaryViolation[] {
  const out: GlossaryViolation[] = [];
  for (const entry of glossary) {
    if (!contains(source, entry.term, entry.caseSensitive)) continue;
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
