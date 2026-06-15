const ICU_PLURAL_SELECT = /\{\s*\w+\s*,\s*(?:plural|select|selectordinal)\s*,/;

// Blank out ICU apostrophe-quoted literal spans so their contents (which may
// contain { } # |) are never read as tokens: '{' is a literal brace, '{name}'
// is the literal text {name}, '' is a literal apostrophe. A lone apostrophe
// (not doubled, not opening a span) is itself literal.
function withoutQuotedSpans(value: string): string {
  if (!value.includes("'")) return value;
  let out = "";
  for (let i = 0; i < value.length; ) {
    if (value[i] === "'") {
      const next = value[i + 1];
      if (next === "'") {
        out += " ";
        i += 2;
        continue;
      }
      if (next === "{" || next === "}" || next === "#" || next === "|") {
        i += 2;
        while (i < value.length && value[i] !== "'") i++;
        i++;
        continue;
      }
    }
    out += value[i];
    i++;
  }
  return out;
}

// Names of the canonical interpolation tokens in a value: simple {name}
// substitutions and ICU plural/select argument names. Storage is always
// canonical — importers normalize :name, %d and friends away — so this
// recognizes only canonical syntax and skips ICU-apostrophe-quoted literals.
export function extractPlaceholders(value: string): string[] {
  const scan = withoutQuotedSpans(value);
  const names = new Set<string>();
  // ICU plural/select argument name(s): {arg, plural|select|selectordinal, ...}
  for (const m of scan.matchAll(/\{\s*(\w+)\s*,\s*(?:plural|select|selectordinal)\s*,/g)) {
    names.add(m[1]!);
  }
  // Simple {name} substitution — only when the string has no ICU plural/select
  // block, to avoid capturing branch bodies like {He}.
  if (!isIcuPluralOrSelect(scan)) {
    for (const m of scan.matchAll(/\{\s*(\w+)\s*\}/g)) names.add(m[1]!);
  }
  return [...names];
}

export function isIcuPluralOrSelect(value: string): boolean {
  return ICU_PLURAL_SELECT.test(value);
}

// Walk a value applying `convertGap` to the text outside ICU apostrophe-quoted
// literal spans, and `emitLiteral` to the unescaped content of each span. A span
// is `'` immediately followed by { } # | running to the next `'`; `''` is a
// literal apostrophe; every other `'` is ordinary text. This is the literal-aware
// counterpart of withoutQuotedSpans: instead of blanking spans it hands their
// content to an adapter, so format converters never rewrite literal tokens.
// Callers must short-circuit ICU plural/select values (their nested braces are
// not gaps) before calling this.
export function withLiterals(
  value: string,
  convertGap: (gap: string) => string,
  emitLiteral: (literal: string) => string,
): string {
  let out = "";
  let gap = "";
  const flushGap = () => {
    if (gap) {
      out += convertGap(gap);
      gap = "";
    }
  };
  for (let i = 0; i < value.length; ) {
    if (value[i] === "'") {
      const next = value[i + 1];
      if (next === "'") {
        gap += "'";
        i += 2;
        continue;
      }
      if (next === "{" || next === "}" || next === "#" || next === "|") {
        flushGap();
        let j = i + 1;
        while (j < value.length && value[j] !== "'") j++;
        out += emitLiteral(value.slice(i + 1, j));
        i = j < value.length ? j + 1 : j;
        continue;
      }
    }
    gap += value[i];
    i++;
  }
  flushGap();
  return out;
}

// The unescaped content of every ICU-quoted literal span in a value, in order.
// Adapters use this to warn when a format would re-interpret a literal (e.g.
// i18next interpolating a literal that contains {{name}}).
export function extractLiterals(value: string): string[] {
  const out: string[] = [];
  withLiterals(value, () => "", (lit) => {
    out.push(lit);
    return "";
  });
  return out;
}

// Each literal in its verbatim apostrophe-quoted form, e.g.
// "Dear '{{gardener}}'" -> ["'{{gardener}}'"]. The AI prompts (translation +
// context) show these so the model reproduces the quoting exactly.
export function quotedLiterals(value: string): string[] {
  return extractLiterals(value).map((content) => `'${content}'`);
}

// {name} -> :name, but leave ICU plural/select blocks untouched. Literal spans
// ('{name}') keep their content verbatim — Laravel only interpolates :name, so
// a bare {name} renders literally.
export function toLaravel(value: string): string {
  if (isIcuPluralOrSelect(value)) return value;
  return withLiterals(value, (gap) => gap.replace(/\{(\w+)\}/g, ":$1"), (lit) => lit);
}

// {name} -> {{name}} (i18next interpolation). Leaves ICU plural/select blocks
// untouched (i18next needs a plugin for those) and never double-wraps a token
// already written as {{name}}. Literal spans are emitted verbatim.
export function toI18next(value: string): string {
  if (isIcuPluralOrSelect(value)) return value;
  return withLiterals(value, (gap) => gap.replace(/(?<!\{)\{(\w+)\}(?!\})/g, "{{$1}}"), (lit) => lit);
}

// {name} -> %{name} (Rails i18n interpolation). Leaves ICU plural/select
// blocks untouched and never double-prefixes a token already written as
// %{name}. Literal spans are emitted verbatim.
export function toRuby(value: string): string {
  if (isIcuPluralOrSelect(value)) return value;
  return withLiterals(value, (gap) => gap.replace(/(?<!%)\{(\w+)\}/g, "%{$1}"), (lit) => lit);
}

export function placeholdersMatch(source: string, translation: string): boolean {
  const a = extractPlaceholders(source).sort();
  const b = extractPlaceholders(translation).sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// True when the translation introduces no placeholder absent from the source.
// Looser than placeholdersMatch: the translation MAY drop source placeholders
// (e.g. an idiomatic "zero" form that omits the count) but MUST NOT invent new
// ones (a renamed or hallucinated token).
export function placeholdersSubset(source: string, translation: string): boolean {
  const allowed = new Set(extractPlaceholders(source));
  return extractPlaceholders(translation).every((p) => allowed.has(p));
}

// Exact-value plural categories (n is 0, 1, or 2) whose idiomatic phrasing can
// replace the digit with a word or grammatical form — Arabic "zero" -> "no
// files", "one" -> "a file", the dual "two". These may DROP a source
// placeholder but must never INVENT one. The range categories (few/many/other)
// span many numbers and so must keep the count via an exact match.
export const COUNT_OPTIONAL: ReadonlySet<string> = new Set(["zero", "one", "two"]);

// Per-form placeholder verdict for a plural category. Count-optional categories
// (zero/one/two) pass as long as they add no placeholder the source lacks; every
// other category must match the source exactly so the count token survives.
export function pluralFormPlaceholdersMatch(category: string, source: string, form: string): boolean {
  return COUNT_OPTIONAL.has(category)
    ? placeholdersSubset(source, form)
    : placeholdersMatch(source, form);
}
