import { findMissing } from "../scan.js";
import { placeholdersMatch, pluralFormPlaceholdersMatch, isIcuPluralOrSelect } from "../placeholders.js";
import { glossaryViolations } from "../glossary.js";
import { spellingRule } from "./spelling.js";
import type { Rule, RawFinding } from "./types.js";

export const emptySourceRule: Rule = {
  id: "empty-source",
  run(state, ctx) {
    const out: RawFinding[] = [];
    for (const key of Object.keys(state.keys)) {
      const entry = state.keys[key]!;
      // Plural keys store per-category forms; "other" is the representative form.
      const v = entry.plural
        ? entry.values[ctx.sourceLocale]?.forms?.other
        : entry.values[ctx.sourceLocale]?.value;
      if (!v || !v.trim()) out.push({ ruleId: "empty-source", key, locale: "", message: "source value is empty" });
    }
    return out;
  },
};

export const emptyTranslationRule: Rule = {
  id: "empty-translation",
  // findMissing is the shared "untranslated" walk (also behind the editor's
  // untranslated check and /scan/missing); a whitespace-only value counts as
  // missing there, so no separate whitespace pass is needed.
  run(state) {
    const out: RawFinding[] = [];
    for (const m of findMissing(state)) {
      out.push({ ruleId: "empty-translation", key: m.key, locale: m.locale, message: "translation is empty or missing" });
    }
    return out;
  },
};

export const identicalToSourceRule: Rule = {
  id: "identical-to-source",
  run(state, ctx) {
    const out: RawFinding[] = [];
    for (const key of Object.keys(state.keys)) {
      const entry = state.keys[key]!;
      // skipTranslate keys (brand names etc.) are meant to stay identical.
      if (entry.skipTranslate) continue;
      const src = entry.values[ctx.sourceLocale]?.value;
      if (!src) continue;
      for (const locale of ctx.targetLocales) {
        const v = entry.values[locale]?.value;
        if (v && v === src) out.push({ ruleId: "identical-to-source", key, locale, message: "translation is identical to the source" });
      }
    }
    return out;
  },
};

export const whitespaceRule: Rule = {
  id: "whitespace",
  run(state, ctx) {
    const out: RawFinding[] = [];
    for (const key of Object.keys(state.keys)) {
      const entry = state.keys[key]!;
      const src = entry.values[ctx.sourceLocale]?.value ?? "";
      const srcEdge = src !== src.trim();
      for (const locale of ctx.targetLocales) {
        const v = entry.values[locale]?.value;
        if (!v) continue;
        if ((v !== v.trim()) !== srcEdge) {
          out.push({ ruleId: "whitespace", key, locale, message: "leading/trailing whitespace differs from the source" });
        }
      }
    }
    return out;
  },
};

export const placeholderMismatchRule: Rule = {
  id: "placeholder-mismatch",
  run(state, ctx) {
    const out: RawFinding[] = [];
    for (const key of Object.keys(state.keys)) {
      const entry = state.keys[key]!;
      // Plural keys compare each target form against the source's "other" form;
      // range categories must keep the count, zero/one/two may drop it idiomatically.
      if (entry.plural) {
        const srcForm = entry.values[ctx.sourceLocale]?.forms?.other;
        if (!srcForm) continue;
        for (const locale of ctx.targetLocales) {
          const forms = entry.values[locale]?.forms;
          if (!forms) continue;
          const bad = Object.entries(forms).some(
            ([cat, form]) => form && !pluralFormPlaceholdersMatch(cat, srcForm, form),
          );
          if (bad) {
            out.push({ ruleId: "placeholder-mismatch", key, locale, message: "placeholders differ from the source" });
          }
        }
        continue;
      }
      const src = entry.values[ctx.sourceLocale]?.value;
      if (!src) continue;
      for (const locale of ctx.targetLocales) {
        const v = entry.values[locale]?.value;
        if (!v) continue;
        if (!placeholdersMatch(src, v)) {
          out.push({ ruleId: "placeholder-mismatch", key, locale, message: "placeholders differ from the source" });
        }
      }
    }
    return out;
  },
};

export const icuMismatchRule: Rule = {
  id: "icu-mismatch",
  run(state, ctx) {
    const out: RawFinding[] = [];
    for (const key of Object.keys(state.keys)) {
      const entry = state.keys[key]!;
      const src = entry.values[ctx.sourceLocale]?.value;
      if (!src) continue;
      const srcIcu = isIcuPluralOrSelect(src);
      for (const locale of ctx.targetLocales) {
        const v = entry.values[locale]?.value;
        if (!v) continue;
        if (isIcuPluralOrSelect(v) !== srcIcu) {
          out.push({
            ruleId: "icu-mismatch", key, locale,
            message: srcIcu
              ? "source is an ICU plural/select but the translation is not"
              : "translation is an ICU plural/select but the source is not",
          });
        }
      }
    }
    return out;
  },
};

export const maxLengthRule: Rule = {
  id: "max-length",
  run(state, ctx) {
    const out: RawFinding[] = [];
    for (const key of Object.keys(state.keys)) {
      const entry = state.keys[key]!;
      const max = entry.maxLength;
      if (max == null) continue;
      for (const locale of ctx.targetLocales) {
        const v = entry.values[locale]?.value;
        if (v && v.length > max) {
          out.push({ ruleId: "max-length", key, locale, message: `length ${v.length} exceeds maxLength ${max}` });
        }
      }
    }
    return out;
  },
};

export const glossaryViolationRule: Rule = {
  id: "glossary-violation",
  run(state, ctx) {
    const out: RawFinding[] = [];
    for (const key of Object.keys(state.keys)) {
      const entry = state.keys[key]!;
      const src = entry.values[ctx.sourceLocale]?.value;
      if (!src) continue;
      for (const locale of ctx.targetLocales) {
        const v = entry.values[locale]?.value;
        if (!v) continue;
        for (const viol of glossaryViolations(src, v, locale, ctx.glossary)) {
          out.push({
            ruleId: "glossary-violation", key, locale,
            message: viol.kind === "do-not-translate"
              ? `do-not-translate term "${viol.term}" is missing or altered`
              : `expected glossary translation "${viol.expected}" for "${viol.term}"`,
          });
        }
      }
    }
    return out;
  },
};

export const ALL_RULES: Rule[] = [
  emptySourceRule,
  emptyTranslationRule,
  placeholderMismatchRule,
  icuMismatchRule,
  glossaryViolationRule,
  maxLengthRule,
  identicalToSourceRule,
  whitespaceRule,
  spellingRule,
];
