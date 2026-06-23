import type { State } from "./schema.js";
import { COUNT_OPTIONAL, extractPlaceholders, placeholdersMatch, pluralFormPlaceholdersMatch } from "./placeholders.js";
import { glossaryViolations } from "./glossary.js";
import { findMissing } from "./scan.js";
import { ignoreWordsFor, spellValue } from "./spell.js";
import { globToRegExp } from "./glob.js";
import type { RuleId } from "./lint/registry.js";
import { findSuppression } from "./lint/suppress.js";
import { icuMismatchRule, identicalToSourceRule, whitespaceRule } from "./lint/rules.js";
import type { LintContext, Rule } from "./lint/types.js";

// "spelling" is checked lazily via the nspell engine (see spell.ts). While a needed
// dictionary is still loading, runChecks returns spellPending=true so the caller refetches.
export const CHECK_IDS = ["untranslated", "placeholder", "spelling", "length", "glossary", "icu", "whitespace", "identical"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface Issue {
  key: string;
  locale: string;
  check: CheckId;
  message: string;
  detail?: string[];
}

export interface CheckOptions {
  only?: CheckId[];
}

export interface CheckResult {
  issues: Issue[];
  spellPending: boolean;
}

// Each editor check mirrors one lint rule, so quality configuration is honoured
// everywhere: a rule turned "off" in config.lint.rules, a key glob in
// config.lint.ignore, or a per-key+locale suppression silences the matching live
// editor issue too — keeping the editor's markers in lockstep with `glotfile lint`.
export const CHECK_RULE: Record<CheckId, RuleId> = {
  untranslated: "empty-translation",
  placeholder: "placeholder-mismatch",
  spelling: "spelling",
  length: "max-length",
  glossary: "glossary-violation",
  icu: "icu-mismatch",
  whitespace: "whitespace",
  identical: "identical-to-source",
};

// Checks that reuse a lint rule wholesale (rather than a bespoke inline pass), so the
// editor surfaces every default-on rule, not just the cheap five. Their messages mirror
// the rule but are phrased for the editor.
const RULE_CHECKS: { id: CheckId; rule: Rule; message: string }[] = [
  { id: "icu", rule: icuMismatchRule, message: "ICU plural/select structure differs from the source" },
  { id: "whitespace", rule: whitespaceRule, message: "Leading/trailing whitespace differs from the source" },
  { id: "identical", rule: identicalToSourceRule, message: "Identical to the source text" },
];

export function runChecks(state: State, opts: CheckOptions = {}): CheckResult {
  const lint = state.config.lint ?? {};
  const localeRules = lint.localeRules;
  // Editor checks default ON (the requested `only`/enabled list is the opt-in, even
  // for spelling); only an explicit config "off" hides one — globally, unless a
  // locale turns it back on. NB: unlike `glotfile lint`, DEFAULT_SEVERITY never gates
  // here, so the per-finding filter below also uses explicit config, not defaults.
  const someLocaleOn = (rule: RuleId) =>
    !!localeRules && Object.values(localeRules).some((r) => r[rule] && r[rule] !== "off");
  const localeOff = (rule: RuleId, locale: string) =>
    ((locale ? localeRules?.[locale]?.[rule] : undefined) ?? lint.rules?.[rule]) === "off";
  const on = (id: CheckId) =>
    (!opts.only || opts.only.includes(id)) && (lint.rules?.[CHECK_RULE[id]] !== "off" || someLocaleOn(CHECK_RULE[id]));
  const issues: Issue[] = [];
  let spellPending = false;
  const { sourceLocale } = state.config;
  const ignore = ignoreWordsFor(state.glossary, state.config.spelling?.customWords);

  // findMissing is the shared "untranslated" walk (also behind the lint
  // empty-translation rule and /scan/missing), so all three stay in lockstep.
  if (on("untranslated")) {
    for (const m of findMissing(state)) {
      issues.push({ key: m.key, locale: m.locale, check: "untranslated", message: "Not translated yet" });
    }
  }

  for (const key of Object.keys(state.keys).sort()) {
    const entry = state.keys[key]!;
    const source = entry.values[sourceLocale]?.value ?? "";

    // Plural keys store per-category `forms`, not a scalar `value`. The only
    // content check that maps onto plural forms is the placeholder check: each
    // form is compared against the source's representative "other" form. Range
    // categories (few/many/other) must keep the count token; the exact-value
    // zero/one/two may idiomatically drop it (see COUNT_OPTIONAL). The remaining
    // scalar checks don't apply per-form, so skip the rest of the loop.
    if (entry.plural) {
      if (on("placeholder")) {
        const sourceForm = entry.values[sourceLocale]?.forms?.other ?? "";
        if (sourceForm.trim() !== "") {
          const sp = extractPlaceholders(sourceForm);
          for (const [locale, lv] of Object.entries(entry.values)) {
            if (locale === sourceLocale || !lv.forms) continue;
            for (const [cat, form] of Object.entries(lv.forms)) {
              const text = form ?? "";
              if (text.trim() === "" || pluralFormPlaceholdersMatch(cat, sourceForm, text)) continue;
              const tp = extractPlaceholders(text);
              // A count-optional form may drop placeholders, so only its invented
              // ones count against it; range forms report drops too.
              const missing = COUNT_OPTIONAL.has(cat) ? [] : sp.filter((p) => !tp.includes(p));
              const extra = tp.filter((p) => !sp.includes(p));
              const parts: string[] = [];
              if (missing.length) parts.push(`missing ${missing.join(", ")}`);
              if (extra.length) parts.push(`extra ${extra.join(", ")}`);
              issues.push({
                key, locale, check: "placeholder",
                message: `Placeholder mismatch (${cat}): ${parts.join("; ")}`,
                detail: [...missing.map((m) => `-${m}`), ...extra.map((e) => `+${e}`)],
              });
            }
          }
        }
      }
      continue;
    }

    for (const [locale, lv] of Object.entries(entry.values)) {
      const value = lv.value ?? "";
      const isSource = locale === sourceLocale;
      const blank = value.trim() === "";

      // length applies to every locale including the source (the source can overrun too).
      if (on("length") && entry.maxLength && value.length > entry.maxLength) {
        issues.push({
          key, locale, check: "length",
          message: `Exceeds max length (${value.length}/${entry.maxLength})`,
          detail: [`${value.length}/${entry.maxLength}`],
        });
      }

      if (on("spelling") && !blank) {
        // Same dictionary mapping the lint runner uses (config.lint.spelling.locales).
        const dictId = state.config.lint?.spelling?.locales?.[locale] ?? locale;
        const bad = spellValue(dictId, value, ignore);
        if (bad === null) spellPending = true;
        else if (bad.length) {
          issues.push({
            key, locale, check: "spelling",
            message: `Possible spelling: ${bad.join(", ")}`,
            detail: bad,
          });
        }
      }

      // Comparison checks only make sense on a non-blank target with a source.
      if (isSource || blank) continue;

      if (on("placeholder") && !placeholdersMatch(source, value)) {
        const sp = extractPlaceholders(source);
        const tp = extractPlaceholders(value);
        const missing = sp.filter((p) => !tp.includes(p));
        const extra = tp.filter((p) => !sp.includes(p));
        const parts: string[] = [];
        if (missing.length) parts.push(`missing ${missing.join(", ")}`);
        if (extra.length) parts.push(`extra ${extra.join(", ")}`);
        issues.push({
          key, locale, check: "placeholder",
          message: `Placeholder mismatch: ${parts.join("; ")}`,
          detail: [...missing.map((m) => `-${m}`), ...extra.map((e) => `+${e}`)],
        });
      }

      if (on("glossary") && source) {
        for (const viol of glossaryViolations(source, value, locale, state.glossary)) {
          issues.push({
            key, locale, check: "glossary",
            message: viol.kind === "do-not-translate"
              ? `Do-not-translate term "${viol.term}" is missing from the translation`
              : `Should use "${viol.expected}" for "${viol.term}"`,
            detail: [viol.expected],
          });
        }
      }
    }
  }

  // Rule-backed checks (icu/whitespace/identical) reuse the lint rule logic verbatim.
  // They only need source + target locales, so a minimal context suffices.
  const ruleChecksOn = RULE_CHECKS.filter((c) => on(c.id));
  if (ruleChecksOn.length) {
    const ctx: LintContext = {
      config: lint,
      sourceLocale,
      targetLocales: state.config.locales.filter((l) => l !== sourceLocale),
      glossary: state.glossary,
      spellers: new Map(),
      allowWords: new Set(),
    };
    for (const { id, rule, message } of ruleChecksOn) {
      for (const f of rule.run(state, ctx)) {
        issues.push({ key: f.key, locale: f.locale, check: id, message });
      }
    }
  }

  const ignoreKey = (lint.ignore ?? []).map(globToRegExp);
  const visible = issues.filter((i) => {
    if (ignoreKey.some((re) => re.test(i.key))) return false;
    // Per-locale "off" (config.lint.localeRules) — or a global rules "off" — silences it.
    if (localeOff(CHECK_RULE[i.check], i.locale)) return false;
    const entry = state.keys[i.key];
    return !entry || !findSuppression(entry, sourceLocale, CHECK_RULE[i.check], i.locale);
  });
  return { issues: visible, spellPending };
}
