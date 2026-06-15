import type { State, OutputConfig, KeyEntry, PluralCategory } from "../schema.js";
import { LOCALE_CASES, type LocaleCase } from "../schema.js";
export type { LocaleCase };

export type EmptyAs = "source" | "empty" | "omit";

// Render glotfile's canonical locale code (lowercase, hyphen-separated) into a
// target ecosystem's casing/separator. bcp47 = language lowercase, 4-letter
// script Titlecase, 2-letter region UPPERCASE, numeric region (e.g. 419) as-is.
export function applyCase(canonical: string, style: LocaleCase): string {
  const sep = style === "lower-underscore" || style === "bcp47-underscore" ? "_" : "-";
  const lower = style === "lower-hyphen" || style === "lower-underscore";
  return canonical
    .split(/[-_]/)
    .map((p, i) => {
      if (lower || i === 0) return p.toLowerCase();
      if (/^[a-z]{4}$/i.test(p)) return p[0]!.toUpperCase() + p.slice(1).toLowerCase();
      if (/^[a-z]{2}$/i.test(p)) return p.toUpperCase();
      return p;
    })
    .join(sep);
}

// The single point where a canonical locale becomes an export token: an exact
// localeMap override wins; otherwise the output's localeCase, else the adapter's
// default. Used for both the {locale} path token and in-file locale tokens.
export function resolveLocaleToken(output: OutputConfig, canonical: string, adapterDefault: LocaleCase): string {
  const mapped = output.localeMap?.[canonical];
  if (mapped !== undefined) return mapped;
  return applyCase(canonical, output.localeCase ?? adapterDefault);
}

// Import helper: given (canonical, observed-filename-token) pairs, choose the
// blanket localeCase that reproduces the most observed tokens (adapter default
// wins ties), then record any locale the chosen style can't reproduce in
// localeMap. Emits only what differs from the adapter default, keeping config
// minimal — a clean xx_YY ARB import yields {}.
export function inferLocaleStyle(
  pairs: [string, string][],
  adapterDefault: LocaleCase,
): { localeCase?: LocaleCase; localeMap?: Record<string, string> } {
  const candidates: LocaleCase[] = [adapterDefault, ...LOCALE_CASES.filter((c) => c !== adapterDefault)];
  let best = adapterDefault;
  let bestScore = -1;
  for (const style of candidates) {
    const score = pairs.filter(([c, obs]) => applyCase(c, style) === obs).length;
    if (score > bestScore) { bestScore = score; best = style; }
  }
  const localeMap: Record<string, string> = {};
  for (const [c, obs] of pairs) {
    if (applyCase(c, best) !== obs) localeMap[c] = obs;
  }
  const result: { localeCase?: LocaleCase; localeMap?: Record<string, string> } = {};
  if (best !== adapterDefault) result.localeCase = best;
  if (Object.keys(localeMap).length) result.localeMap = localeMap;
  return result;
}

// Effective indent/finalNewline for an output: per-output overrides win over the
// project-global config.format. (sortKeys is not part of this — every adapter
// orders deterministically on its own, per the export-fidelity spec.)
export function resolveFormat(state: State, output: OutputConfig): { indent: number; finalNewline: boolean } {
  const f = state.config.format;
  return {
    indent: output.indent ?? f.indent,
    finalNewline: output.finalNewline ?? f.finalNewline,
  };
}

export function resolveEmptyAs(output: OutputConfig, fallback: EmptyAs): EmptyAs {
  return output.emptyAs ?? fallback;
}

// The scalar to write for (key, locale), or null to omit the key entirely.
// The source locale is the anchor and always writes (even an empty string).
export function resolveScalar(
  entry: KeyEntry, locale: string, sourceLocale: string, emptyAs: EmptyAs,
): string | null {
  const raw = entry.values[locale]?.value ?? "";
  if (raw) return raw;
  if (locale === sourceLocale) return raw;
  if (emptyAs === "omit") return null;
  if (emptyAs === "empty") return "";
  return entry.values[sourceLocale]?.value ?? "";
}

// Plural-form equivalent of resolveScalar. Returns the forms map to write, or null
// to omit. A target is "translated" when it has an `other` form.
export function resolveForms(
  entry: KeyEntry, locale: string, sourceLocale: string, emptyAs: EmptyAs,
): Partial<Record<PluralCategory, string>> | null {
  const forms = entry.values[locale]?.forms;
  if (forms?.other) return forms;
  if (locale === sourceLocale) return forms ?? { other: "" };
  if (emptyAs === "omit") return null;
  if (emptyAs === "empty") return { other: "" };
  return entry.values[sourceLocale]?.forms ?? { other: "" };
}
