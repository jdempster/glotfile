import type { LintSeverity } from "@/types.js";

// The configurable lint rules, mirroring the server registry (src/server/lint/registry.ts):
// same ids, same default severities. "output-stale" is a drift check, not a rule,
// so it isn't configurable here.
export interface LintRuleMeta {
  id: string;
  label: string;
  description: string;
  default: Exclude<LintSeverity, "off">;
}

export const LINT_RULES: LintRuleMeta[] = [
  { id: "empty-source", label: "Empty source", description: "The source text itself is empty.", default: "error" },
  { id: "empty-translation", label: "Untranslated", description: "A target translation is missing or blank.", default: "error" },
  { id: "placeholder-mismatch", label: "Placeholder mismatch", description: "Placeholders differ between source and translation.", default: "error" },
  { id: "icu-mismatch", label: "ICU mismatch", description: "ICU plural/select structure differs from the source.", default: "error" },
  { id: "glossary-violation", label: "Glossary", description: "A glossary term is missing or translated incorrectly.", default: "error" },
  { id: "max-length", label: "Too long", description: "The translation exceeds the key's maximum length.", default: "warn" },
  { id: "identical-to-source", label: "Identical to source", description: "The translation is exactly the source text.", default: "warn" },
  { id: "whitespace", label: "Whitespace", description: "Leading/trailing whitespace differs from the source.", default: "warn" },
  { id: "spelling", label: "Spelling", description: "A word isn't in the locale's dictionary, the glossary, or your custom dictionary.", default: "warn" },
];

export const RULE_DEFAULTS: Record<string, LintSeverity> =
  Object.fromEntries(LINT_RULES.map((r) => [r.id, r.default]));
