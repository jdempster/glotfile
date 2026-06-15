import type { State, KeyEntry, LocaleState, OutputConfig } from "../schema.js";
import { CURRENT_VERSION } from "../schema.js";
import { parseIcuPlural, exactFormsToCldr } from "../plurals.js";
import type { ParseResult } from "./types.js";
import { canonLocale } from "../state.js";
import { getAdapter } from "../adapters/index.js";
import { inferLocaleStyle } from "../adapters/options.js";

// rootRelative: the path template is relative to the detected locale root rather
// than the project root, so the locale root's offset is prepended (see runImport).
// Apple .lproj dirs commonly live under an app subfolder, so the import writes the
// export back where it found them instead of at the repo root.
const OUTPUT_BY_FORMAT: Record<
  string,
  { adapter: string; path: string; rootRelative?: boolean; skipSourceLocale?: boolean }
> = {
  "laravel-php": { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" },
  "vue-i18n-json": { adapter: "vue-i18n-json", path: "src/locale/{locale}.json" },
  "flutter-arb": { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" },
  "apple-strings": { adapter: "apple-strings", path: "{locale}.lproj/Localizable.strings", rootRelative: true },
  // skipSourceLocale: ng extract-i18n owns messages.xlf (the source file); glotfile
  // only writes the translation files back next to it.
  "angular-xliff": { adapter: "angular-xliff", path: "messages.{locale}.xlf", rootRelative: true, skipSourceLocale: true },
  "gettext-po": { adapter: "gettext-po", path: "{locale}.po", rootRelative: true },
  "i18next-json": { adapter: "i18next-json", path: "{locale}/translation.json", rootRelative: true },
  "rails-yaml": { adapter: "rails-yaml", path: "config/locales/{locale}.yml" },
  "apple-stringsdict": { adapter: "apple-stringsdict", path: "{locale}.lproj/Localizable.stringsdict", rootRelative: true },
};

export interface AssembleResult extends State {
  warnings: string[];
}

export function assemble(
  parsed: ParseResult,
  // cldr: rewrite exact "=N" plural selectors into each locale's CLDR categories
  // (Crowdin-style). Off by default — the lossless import keeps "=N" verbatim.
  // localeRootRel: project-root-relative offset of the detected locale root, used
  // for rootRelative formats so the output path points back at the source files.
  opts: { sourceLocale: string; format: string; cldr?: boolean; localeRootRel?: string },
): AssembleResult {
  const warnings = [...parsed.warnings];
  const base = OUTPUT_BY_FORMAT[opts.format];
  if (!base) throw new Error(`No output mapping for format "${opts.format}"`);

  const prefix = (opts.localeRootRel ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const path = base.rootRelative && prefix ? `${prefix}/${base.path}` : base.path;

  // Observed filename tokens (raw, pre-canonicalization) drive locale inference.
  const rawLocales = [...new Set([opts.sourceLocale, ...parsed.locales])];
  const pairs: [string, string][] = rawLocales.map((obs) => [canonLocale(obs), obs]);
  const inferred = inferLocaleStyle(pairs, getAdapter(base.adapter).defaultLocaleCase);
  const { rootRelative: _rootRelative, ...baseOutput } = base;
  const output: OutputConfig = { ...baseOutput, path, ...inferred };

  // config.locales / sourceLocale are emitted canonical so validation (and the
  // localeMap subset check) is self-consistent before saveState normalizes.
  const sourceLocale = canonLocale(opts.sourceLocale);
  const locales = [...new Set(rawLocales.map(canonLocale))].sort();

  const keys: Record<string, KeyEntry> = {};
  for (const [key, parsed_key] of Object.entries(parsed.keys)) {
    const entry: KeyEntry = { values: {} };
    // The source value is the structural authority: a key is plural only when its
    // source parses as a single ICU plural. This keeps a stray ICU-looking
    // translation from flipping an otherwise-scalar key.
    const sourceRaw = parsed_key.values[opts.sourceLocale];
    const sourcePlural = sourceRaw !== undefined ? parseIcuPlural(sourceRaw) : null;
    if (sourcePlural) {
      entry.plural = { arg: sourcePlural.arg };
      for (const [locale, value] of Object.entries(parsed_key.values)) {
        const state: LocaleState = locale === opts.sourceLocale ? "source" : "reviewed";
        const parsedForms = locale === opts.sourceLocale ? sourcePlural : parseIcuPlural(value);
        if (parsedForms) {
          const forms = opts.cldr ? exactFormsToCldr(locale, parsedForms.forms) : parsedForms.forms;
          entry.values[locale] = { forms, state };
        } else {
          // Don't drop a translation we can't parse: keep it verbatim under "other"
          // (the one form ICU always requires) and flag it for review.
          entry.values[locale] = { forms: { other: value }, state };
          warnings.push(
            `key "${key}" locale "${locale}": value is not a parseable ICU plural; preserved under "other".`,
          );
        }
      }
    } else {
      for (const [locale, value] of Object.entries(parsed_key.values)) {
        entry.values[locale] = {
          value,
          state: locale === opts.sourceLocale ? "source" : "reviewed",
        };
      }
    }
    if (!(opts.sourceLocale in entry.values)) {
      warnings.push(
        `key "${key}" has no ${opts.sourceLocale} (source) value; its values are marked reviewed without a source.`,
      );
    }
    // Remap value keys to canonical form so the returned state is self-consistent
    // with config.locales (which are also canonical). Must run AFTER the orphan
    // warning check above, which compares raw opts.sourceLocale to raw value keys.
    const canonValues: typeof entry.values = {};
    for (const [loc, lv] of Object.entries(entry.values)) canonValues[canonLocale(loc)] = lv;
    entry.values = canonValues;
    if (parsed_key.placeholders) entry.placeholders = parsed_key.placeholders;
    keys[key] = entry;
  }

  return {
    $schema: "https://glotfile.dev/schema/v1.json",
    version: CURRENT_VERSION,
    config: {
      sourceLocale,
      locales,
      outputs: [output],
      format: { indent: 2, sortKeys: true, finalNewline: true },
      spelling: { customWords: [] },
    },
    glossary: [],
    keys,
    warnings,
  };
}
