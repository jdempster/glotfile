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
