export type Severity = "error" | "warn" | "off";

export const RULE_IDS = [
  "empty-source",
  "empty-translation",
  "placeholder-mismatch",
  "icu-mismatch",
  "glossary-violation",
  "max-length",
  "identical-to-source",
  "whitespace",
  "spelling",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

// The rule ids in `ids` that aren't real rules — used to reject bad --rule
// filters loudly instead of silently matching nothing and reporting clean.
export function unknownRuleIds(ids: string[]): string[] {
  const valid = new Set<string>(RULE_IDS);
  return ids.filter((id) => !valid.has(id));
}

// Best-effort "did you mean" for a mistyped rule id, e.g. "glossary" ->
// "glossary-violation", "placeholder" -> "placeholder-mismatch".
export function suggestRuleId(unknown: string): string | undefined {
  const lower = unknown.toLowerCase();
  return RULE_IDS.find((id) => id.includes(lower) || lower.includes(id));
}

export const DEFAULT_SEVERITY: Record<RuleId, Severity> = {
  "empty-source": "error",
  "empty-translation": "error",
  "placeholder-mismatch": "error",
  "icu-mismatch": "error",
  "glossary-violation": "error",
  "max-length": "warn",
  "identical-to-source": "warn",
  "whitespace": "warn",
  "spelling": "warn",
};
