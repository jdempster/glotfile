import type { State } from "../schema.js";

export interface GlossarySource {
  key: string;
  source: string;
}

export interface SuggestedTerm {
  term: string;
  note?: string;
  doNotTranslate?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface GlossarySuggestSelectOptions {
  keyGlob?: string;
  limit?: number;
  since?: string;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

// Source strings to feed the detector: every key's source-locale value (or the
// plural `other` form), newest-first, filtered by glob/since, capped by limit.
// Empty sources are dropped — nothing to mine.
export function selectGlossarySources(state: State, opts: GlossarySuggestSelectOptions): GlossarySource[] {
  const keyRe = opts.keyGlob ? globToRegExp(opts.keyGlob) : null;
  let rows: GlossarySource[] = [];
  for (const key of Object.keys(state.keys)) {
    if (keyRe && !keyRe.test(key)) continue;
    const entry = state.keys[key]!;
    if (opts.since) {
      if (!entry.createdAt || entry.createdAt < opts.since) continue;
    }
    const lv = entry.values[state.config.sourceLocale];
    const source = (lv?.value ?? lv?.forms?.other ?? "").trim();
    if (!source) continue;
    rows.push({ key, source });
  }
  rows.sort((a, b) => {
    const ta = state.keys[a.key]!.createdAt ?? "";
    const tb = state.keys[b.key]!.createdAt ?? "";
    return tb.localeCompare(ta) || a.key.localeCompare(b.key);
  });
  if (opts.limit !== undefined) rows = rows.slice(0, opts.limit);
  return rows;
}

export function knownTermList(state: State): string[] {
  const out = new Set<string>();
  for (const g of state.glossary) out.add(g.term);
  for (const s of state.glossarySuggestions) out.add(s.term);
  return [...out];
}

export function buildGlossarySuggestSystemPrompt(): string {
  return [
    "You identify GLOSSARY-CANDIDATE terms in a UI string catalog so they translate consistently.",
    "A glossary term is a brand or product name, a feature or module name, an acronym, a piece of domain/industry jargon, or any noun phrase that should translate the SAME way everywhere (or stay verbatim).",
    "You are given source strings (the app's original language). Return the candidate terms you find.",
    "Rules:",
    "- Only surface terms a translator would benefit from pinning. IGNORE ordinary words, verbs, and generic UI labels (e.g. 'Save', 'Cancel', 'Welcome').",
    "- Prefer terms that recur or are clearly proper nouns / product names / acronyms.",
    "- Set doNotTranslate: true for brand/product names, code identifiers, and acronyms that must stay verbatim in every language.",
    "- Set caseSensitive: true only when casing is meaningful (e.g. an all-caps acronym that must not match a lowercase common word).",
    "- Set wholeWord: false ONLY if the term should also match inside larger words; otherwise omit it (whole-word is the default).",
    "- note: one short phrase on why it's a term (e.g. 'product name', 'industry acronym', 'recurring UI concept'). Keep it under 80 characters.",
    "- Do NOT return any term in the provided 'Already known' list.",
    "- Return the term exactly as it appears in the source (preserve casing).",
  ].join("\n");
}

export function buildGlossarySuggestBatchPrompt(sources: GlossarySource[], knownTerms: string[]): string {
  const known = knownTerms.length ? knownTerms.join(", ") : "(none yet)";
  const lines = sources.map((s) => `- [${s.key}] ${s.source}`).join("\n");
  return [
    `Already known (do NOT return these): ${known}`,
    "",
    "Source strings:",
    lines,
    "",
    'Return JSON {"terms":[{"term","note?","doNotTranslate?","caseSensitive?","wholeWord?"}]}. Return an empty array if you find no good candidates.',
  ].join("\n");
}

export const GLOSSARY_SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    terms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          note: { type: "string" },
          doNotTranslate: { type: "boolean" },
          caseSensitive: { type: "boolean" },
          wholeWord: { type: "boolean" },
        },
        required: ["term"],
        additionalProperties: false,
      },
    },
  },
  required: ["terms"],
  additionalProperties: false,
} as const;

// Collapse case-variant duplicates accumulated across batches; first occurrence
// wins (keeps its note/flags).
export function dedupeTerms(terms: SuggestedTerm[]): SuggestedTerm[] {
  const seen = new Set<string>();
  const out: SuggestedTerm[] = [];
  for (const t of terms) {
    const term = t.term?.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...t, term });
  }
  return out;
}
