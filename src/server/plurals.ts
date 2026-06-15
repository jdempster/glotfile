import { PLURAL_CATEGORIES, isPluralForm, type PluralCategory, type PluralForm } from "./schema.js";

// Catalog locale codes are normalized with underscores (e.g. "en_us"), but
// Intl.PluralRules needs BCP-47 hyphens or it throws on the region subtag.
function bcp47(locale: string): string {
  return locale.replace(/_/g, "-");
}

// Cardinal plural categories valid for a locale, per the platform's CLDR data,
// re-sorted into our canonical order. No bundled data — Intl.PluralRules is the
// standard. Unknown/invalid tags degrade to the universal ["other"].
export function categoriesFor(locale: string): PluralCategory[] {
  let reported: readonly string[];
  try {
    reported = new Intl.PluralRules(bcp47(locale), { type: "cardinal" }).resolvedOptions().pluralCategories;
  } catch {
    reported = ["other"];
  }
  const set = new Set(reported);
  return PLURAL_CATEGORIES.filter((c) => set.has(c));
}

export interface ParsedPlural {
  arg: string;
  forms: Partial<Record<PluralForm, string>>;
}

// Parse a string that is ENTIRELY a single ICU cardinal plural:
// {arg, plural, sel {body} sel {body} ...}. Selectors may be CLDR categories
// (one, other, …) or explicit value matches (=0, =1, …). Returns null for
// anything else — plain text, select, surrounding text, or a missing "other" —
// so callers never misclassify (and migration never corrupts).
// `#` inside a body is normalized to the `{arg}` token.
export function parseIcuPlural(icu: string): ParsedPlural | null {
  const s = icu.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return null;
  const head = /^\{\s*(\w+)\s*,\s*plural\s*,/.exec(s);
  if (!head) return null;
  const arg = head[1]!;
  const end = s.length - 1; // index of the plural's closing brace
  let i = head[0].length;
  const forms: Partial<Record<PluralForm, string>> = {};
  while (i < end) {
    while (i < end && /\s/.test(s[i]!)) i++;
    if (i >= end) break;
    // selector token: up to whitespace or "{" (a category like "one" or an exact "=1")
    const catStart = i;
    while (i < end && !/\s/.test(s[i]!) && s[i] !== "{") i++;
    const cat = s.slice(catStart, i);
    while (i < end && /\s/.test(s[i]!)) i++;
    if (s[i] !== "{") return null;
    // balanced-brace body
    let depth = 0;
    const bodyStart = i + 1;
    for (; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) return null;
    const body = s.slice(bodyStart, i);
    i++; // step past the body's closing brace
    if (!isPluralForm(cat)) return null;
    // A duplicate selector is malformed ICU; reject rather than silently
    // last-wins (which would drop a branch's text).
    if (forms[cat as PluralForm] !== undefined) return null;
    forms[cat as PluralForm] = body.replace(/#/g, `{${arg}}`);
  }
  if (typeof forms.other !== "string") return null;
  return { arg, forms };
}

// Inverse of parseIcuPlural. Emits explicit (=N) selectors first in numeric
// order, then keyword categories in canonical order — the ordering ICU uses and
// gen_l10n expects. The `{arg}` token is left as-is; callers that want ICU's `#`
// substitute it themselves.
export function formsToIcu(arg: string, forms: Partial<Record<PluralForm, string>>): string {
  const parts: string[] = [];
  const exact = Object.keys(forms)
    .filter((k) => /^=\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  for (const sel of exact) parts.push(`${sel} {${forms[sel as PluralForm]}}`);
  for (const cat of PLURAL_CATEGORIES) {
    const body = forms[cat];
    if (body !== undefined) parts.push(`${cat} {${body}}`);
  }
  return `{${arg}, plural, ${parts.join(" ")}}`;
}

// Rewrite forms that use exact "=N" selectors into a locale's CLDR categories,
// the way Crowdin's pipeline does. For each required category of `locale`, the
// text is chosen by priority: an exact selector "=N" whose number maps to that
// category (via Intl.PluralRules) wins; else an already-present form for that
// category; else the "other" form. Exact selectors that map to "other" (e.g. "=1"
// in ja/zh, which lack a distinct "one") fold away. Forms with no exact selectors
// are already CLDR and returned unchanged. The result is keyed only by categories.
export function exactFormsToCldr(
  locale: string,
  forms: Partial<Record<PluralForm, string>>,
): Partial<Record<PluralCategory, string>> {
  const exactKeys = Object.keys(forms).filter((k) => /^=\d+$/.test(k));
  if (exactKeys.length === 0) return { ...forms } as Partial<Record<PluralCategory, string>>;

  let pr: Intl.PluralRules;
  try {
    pr = new Intl.PluralRules(bcp47(locale), { type: "cardinal" });
  } catch {
    // Unknown tag → only "other" is meaningful; keep the catch-all text.
    return { other: forms.other ?? "" };
  }

  // The exact selector (lowest N) that resolves to each non-"other" category.
  const exactByCat = new Map<PluralCategory, string>();
  for (const k of exactKeys.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const cat = pr.select(Number(k.slice(1))) as PluralCategory;
    if (cat !== "other" && !exactByCat.has(cat)) exactByCat.set(cat, forms[k as PluralForm]!);
  }

  const out: Partial<Record<PluralCategory, string>> = {};
  for (const c of categoriesFor(locale)) {
    out[c] = exactByCat.get(c) ?? forms[c] ?? forms.other ?? "";
  }
  return out;
}

// A gettext `Plural-Forms` value (nplurals + the C `plural=` expression) for a
// locale, derived from Intl.PluralRules with no bundled CLDR data. `expr` and
// the msgstr[i] ordering callers use share the same canonical-index mapping, so
// they are consistent by construction and exact for n in 0..200. For periodic
// rules (pl, ru, …) the open tail can be wrong for large n, so `sampled` is
// true and the adapter warns. (one|other and single-form locales are exact.)
export function gettextPluralForms(locale: string): { nplurals: number; expr: string; sampled: boolean } {
  const cats = categoriesFor(locale);
  const nplurals = cats.length;
  if (nplurals === 1) return { nplurals: 1, expr: "0", sampled: false };
  let pr: Intl.PluralRules;
  try {
    pr = new Intl.PluralRules(bcp47(locale), { type: "cardinal" });
  } catch {
    return { nplurals: 1, expr: "0", sampled: false };
  }
  // The canonical English-family 2-form rule: 1 is "one", everything else
  // (including 0) is "other". Only take this shortcut when the locale really
  // follows it — many [one, other] locales (hi, fa, am, …) put 0 in "one",
  // for which (n != 1) would be wrong; those fall through to sampling.
  if (
    nplurals === 2 && cats[0] === "one" && cats[1] === "other" &&
    pr.select(0) === "other" && pr.select(1) === "one"
  ) {
    return { nplurals: 2, expr: "(n != 1)", sampled: false };
  }
  const index = new Map(cats.map((c, i) => [c, i] as const));
  const idxOf = (n: number) => index.get(pr.select(n) as PluralCategory) ?? 0;
  // Run-length-encode the index sequence over 0..MAX into contiguous ranges.
  const MAX = 200;
  const runs: { start: number; end: number; idx: number }[] = [];
  for (let n = 0; n <= MAX; n++) {
    const i = idxOf(n);
    const last = runs[runs.length - 1];
    if (last && last.idx === i && last.end === n - 1) last.end = n;
    else runs.push({ start: n, end: n, idx: i });
  }
  // The final run is the else; earlier runs become ordered ternary conditions.
  let expr = String(runs[runs.length - 1]!.idx);
  for (let r = runs.length - 2; r >= 0; r--) {
    const { start, end, idx } = runs[r]!;
    const cond = start === end ? `n == ${start}` : `n >= ${start} && n <= ${end}`;
    expr = `(${cond}) ? ${idx} : ${expr}`;
  }
  return { nplurals, expr, sampled: true };
}
