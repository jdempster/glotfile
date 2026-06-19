import type { State } from "../schema.js";

export interface GlossarySource {
  key: string;
  source: string;
}

export interface SuggestedTerm {
  term: string;
  aliases?: string[];
  note?: string;
  doNotTranslate?: boolean;
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
    "- aliases: other surface forms of the SAME term that appear (or plausibly appear) in the strings — inflections, plurals, casing variants (e.g. for 'feed': ['feeding', 'feeds', 'fed']). Matching is whole-word, so list the forms that should also be governed by this term. Omit if there are none.",
    "- note: a short phrase. For a homonym or domain word, say what it MEANS so it translates in the right sense (e.g. 'feed = give fertilizer, not a social feed'); otherwise why it's a term ('product name', 'industry acronym'). Keep it under 80 characters.",
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
    'Return JSON {"terms":[{"term","aliases?","note?","doNotTranslate?"}]}. Return an empty array if you find no good candidates.',
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
          aliases: { type: "array", items: { type: "string" } },
          note: { type: "string" },
          doNotTranslate: { type: "boolean" },
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
