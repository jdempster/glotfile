import type { LintConfig } from "../schema.js";
import { DEFAULT_SEVERITY, type RuleId, type Severity } from "./registry.js";

// Effective severity for a rule, layering (highest first): a per-locale override,
// the global rule severity, then the built-in default. Pass the finding's locale to
// honour config.lint.localeRules; omit it for project-level findings.
export function resolveSeverity(id: RuleId, config: LintConfig, locale?: string): Severity {
  const perLocale = locale ? config.localeRules?.[locale]?.[id] : undefined;
  return (perLocale as Severity | undefined) ?? config.rules?.[id] ?? DEFAULT_SEVERITY[id];
}

// Whether a rule can produce any finding: on globally, or turned on for some locale.
// Used to decide if a rule is worth running at all before per-finding severity applies.
export function ruleEverActive(id: RuleId, config: LintConfig): boolean {
  if ((config.rules?.[id] ?? DEFAULT_SEVERITY[id]) !== "off") return true;
  const byLocale = config.localeRules;
  if (byLocale) {
    for (const locale of Object.keys(byLocale)) {
      if ((byLocale[locale]?.[id] ?? "off") !== "off") return true;
    }
  }
  return false;
}
