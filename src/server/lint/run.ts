import type { State, LintConfig } from "../schema.js";
import { globToRegExp } from "../glob.js";
import { DEFAULT_SEVERITY, type Severity, type RuleId } from "./registry.js";
import { ALL_RULES } from "./rules.js";
import { defaultLoader, type DictionaryLoader } from "./spelling.js";
import { ignoreWordsFor } from "../spell.js";
import { findSuppression } from "./suppress.js";
import type { Finding, LintContext, LintReport, Rule, Speller } from "./types.js";

export interface RunOptions {
  rules?: Rule[];
  locales?: string[];
  ruleIds?: string[];
  loadSpeller?: DictionaryLoader;
  warn?: (msg: string) => void;
  // Keep findings hidden by per-key suppressions in the report (flagged
  // suppressed: true); they never contribute to counts.error/warn or ok.
  includeSuppressed?: boolean;
}

function resolveSeverity(id: RuleId, config: LintConfig): Severity {
  return config.rules?.[id] ?? DEFAULT_SEVERITY[id];
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => a.key.localeCompare(b.key) || a.locale.localeCompare(b.locale) || a.ruleId.localeCompare(b.ruleId),
  );
}

export function countSeverities(findings: Finding[]): { error: number; warn: number } {
  let error = 0, warn = 0;
  for (const f of findings) {
    if (f.suppressed) continue;
    (f.severity === "error" ? error++ : warn++);
  }
  return { error, warn };
}

async function loadSpellers(
  locales: string[], config: LintConfig, load: DictionaryLoader, warn: (m: string) => void,
): Promise<Map<string, Speller>> {
  const map = new Map<string, Speller>();
  for (const locale of locales) {
    const dictId = config.spelling?.locales?.[locale] ?? locale;
    const speller = await load(dictId);
    if (speller) map.set(locale, speller);
    else warn(`no dictionary for "${locale}", skipping spelling`);
  }
  return map;
}

export async function runLint(state: State, options: RunOptions = {}): Promise<LintReport> {
  const config = state.config.lint ?? {};
  const rules = options.rules ?? ALL_RULES;
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const load = options.loadSpeller ?? defaultLoader;
  const targetLocales = state.config.locales.filter((l) => l !== state.config.sourceLocale);

  const isActive = (rule: Rule): boolean => {
    if (options.ruleIds && !options.ruleIds.includes(rule.id)) return false;
    return resolveSeverity(rule.id, config) !== "off";
  };
  const active = rules.filter(isActive);

  const spellingOn = active.some((r) => r.id === "spelling");
  const spellers = spellingOn ? await loadSpellers(targetLocales, config, load, warn) : new Map<string, Speller>();
  const allowWords = spellingOn ? ignoreWordsFor(state.glossary, state.config.spelling?.customWords) : new Set<string>();

  const ctx: LintContext = {
    config, sourceLocale: state.config.sourceLocale, targetLocales, glossary: state.glossary, spellers, allowWords,
  };

  const ignoreRes = (config.ignore ?? []).map(globToRegExp);
  const localeFilter = options.locales ? new Set(options.locales) : null;

  const findings: Finding[] = [];
  let suppressed = 0;
  for (const rule of active) {
    const severity = resolveSeverity(rule.id, config) as Exclude<Severity, "off">;
    for (const raw of rule.run(state, ctx)) {
      if (ignoreRes.some((re) => re.test(raw.key))) continue;
      if (localeFilter && raw.locale !== "" && !localeFilter.has(raw.locale)) continue;
      const entry = state.keys[raw.key];
      if (raw.locale !== "" && entry && findSuppression(entry, state.config.sourceLocale, rule.id, raw.locale)) {
        suppressed++;
        if (options.includeSuppressed) findings.push({ ...raw, severity, suppressed: true });
        continue;
      }
      findings.push({ ...raw, severity });
    }
  }

  const sorted = sortFindings(findings);
  const counts = { ...countSeverities(sorted), suppressed };
  return { findings: sorted, counts, ok: counts.error === 0 };
}
