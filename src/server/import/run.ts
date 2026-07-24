import { relative } from "node:path";
import { detect } from "./detect.js";
import { getParser } from "./parsers/index.js";
import { assemble } from "./assemble.js";
import { mergeStates, type SyncPlan } from "./merge.js";
import { loadState } from "../state.js";
import { validate } from "../schema.js";
import { categoriesFor } from "../plurals.js";
import { PLURAL_CATEGORIES } from "../schema.js";
import type { State, PluralForm } from "../schema.js";

// The separator the vue-i18n adapter joins plural forms with.
const VUE_PLURAL_SEP = " | ";

// Which categories the pipe-separated parts map onto, in canonical order. vue-i18n
// forms are positional with no labels, so we recover them by count, most-faithful
// first: the shape the catalog already recorded, then the locale's full CLDR set,
// then vue-i18n's default positional convention (2 → one/other, 3 → zero/one/other,
// mirroring its getChoiceIndex), then a leading-categories fallback.
function partCategories(
  locale: string,
  count: number,
  existingForms: Partial<Record<PluralForm, string>> | undefined,
): PluralForm[] {
  if (existingForms) {
    const present = PLURAL_CATEGORIES.filter((c) => existingForms[c] !== undefined);
    if (present.length === count) return present;
  }
  const cldr = categoriesFor(locale);
  if (count === cldr.length) return cldr;
  if (count === 1) return ["other"];
  if (count === 2) return ["one", "other"];
  if (count === 3) return ["zero", "one", "other"];
  const lead = PLURAL_CATEGORIES.filter((c) => c !== "other").slice(0, count - 1);
  return [...lead, "other"];
}

// vue-i18n serializes plural forms as a positional "a | b | c" string with no
// in-file marker, so its parser reads them back as scalars. Left alone, a resync
// would shape-flip a catalog plural into a scalar and drop its translations. For
// any key the catalog already knows is a plural whose re-parsed source still
// carries the pipe shape, rebuild the incoming forms by splitting on the vue
// separator. Guarded by the existing plural, so plain (first-time) import — where
// a pipe could be a legitimate scalar — is untouched.
function restoreVuePluralShapes(incoming: State, existing: State): void {
  const src = existing.config.sourceLocale;
  for (const [key, inc] of Object.entries(incoming.keys)) {
    const cur = existing.keys[key];
    if (!cur?.plural || inc.plural) continue;
    const srcVal = inc.values[src]?.value;
    if (srcVal === undefined || !srcVal.includes(VUE_PLURAL_SEP)) continue;
    inc.plural = { arg: cur.plural.arg };
    for (const [loc, lv] of Object.entries(inc.values)) {
      if (lv.value === undefined) continue;
      const parts = lv.value.split(VUE_PLURAL_SEP);
      const cats = partCategories(loc, parts.length, cur.values[loc]?.forms);
      const forms: Partial<Record<PluralForm, string>> = {};
      cats.forEach((c, i) => { if (parts[i] !== undefined) forms[c] = parts[i]!; });
      inc.values[loc] = { forms, state: lv.state };
    }
  }
}

export interface RunImportOptions {
  /** Absolute path to the project root (same dir as glotfile.json). */
  projectRoot: string;
  format?: string;
  sourceLocale?: string;
  locales?: string[];
  /** Convert exact "=N" plural selectors into CLDR categories (Crowdin-style). */
  cldr?: boolean;
}

export interface RunImportResult {
  state: State;
  warnings: string[];
  keyCount: number;
  localeCount: number;
}

export interface ImportPreview {
  format: string;
  localeRoot: string;
  locales: string[];
  sourceLocale: string;
  keyCount: number;
  sampleKeys: { key: string; value: string }[];
}

// Detection enriched with a one-time parse so the wizard's Confirm step can show
// the real key count and a handful of sample source-locale strings (FR-36 design).
// Only the source locale is parsed here: the key count is the number of distinct
// keys (which the source defines) and the samples are source strings, so reading
// the other locales' files would be wasted work on a large project.
export function previewImport(projectRoot: string, format?: string): ImportPreview | null {
  const det = detect(projectRoot, format);
  if (!det) return null;
  const parsed = getParser(det.format).parse(det.localeRoot, { locales: [det.sourceLocale] });
  const keys = Object.keys(parsed.keys);
  const sampleKeys: { key: string; value: string }[] = [];
  for (const key of keys) {
    const value = parsed.keys[key]!.values[det.sourceLocale];
    if (typeof value === "string") {
      sampleKeys.push({ key, value });
      if (sampleKeys.length >= 5) break;
    }
  }
  return {
    format: det.format,
    localeRoot: det.localeRoot,
    locales: det.locales,
    sourceLocale: det.sourceLocale,
    keyCount: keys.length,
    sampleKeys,
  };
}

export interface RunSyncOptions extends RunImportOptions {
  /** Path to the existing glotfile.json (or split dir base) to merge into. */
  statePath: string;
  /** Delete keys that are gone from the import (default: report only). */
  prune?: boolean;
}

export interface RunSyncResult {
  state: State;
  plan: SyncPlan;
  warnings: string[];
  keyCount: number;
}

// Re-import the locale files and merge them into the existing catalog instead of
// rebuilding it: parse → assemble an `incoming` State (reusing all the plural /
// placeholder / canonicalization logic) → mergeStates preserves everything
// glotfile owns. The returned state is NOT persisted — callers save it (or, for a
// dry run, inspect only the plan).
export function runSync(opts: RunSyncOptions): RunSyncResult {
  const det = detect(opts.projectRoot, opts.format);
  if (!det) throw new Error(`No recognized locale files found in ${opts.projectRoot}`);

  const parser = getParser(det.format);
  const sourceLocale = opts.sourceLocale ?? det.sourceLocale;
  const parsed = parser.parse(
    det.localeRoot,
    opts.locales ? { locales: opts.locales } : undefined,
  );

  // The source-locale file is the authority on which keys are live: a key deleted
  // from it but still lingering in a stale translation file (e.g. glotfile's own
  // messages.<locale>.xlf export) must register as removed, not survive in the
  // merged parse. Parsing source-only filters the translation files out.
  const sourceParse = parser.parse(det.localeRoot, { locales: [sourceLocale] });
  const liveKeys = new Set(Object.keys(sourceParse.keys));

  const assembled = assemble(parsed, {
    sourceLocale,
    format: det.format,
    cldr: opts.cldr,
    localeRootRel: relative(opts.projectRoot, det.localeRoot),
  });
  const { warnings, ...rest } = assembled;
  const incoming = validate(rest);

  const existing = loadState(opts.statePath);
  // vue-i18n plurals lose their shape through its lossy pipe serialization; rebuild
  // them from the catalog before merging so resync doesn't clobber a known plural.
  if (det.format === "vue-i18n-json") restoreVuePluralShapes(incoming, existing);
  const { state, plan } = mergeStates(existing, incoming, { prune: opts.prune, liveKeys });

  return { state, plan, warnings, keyCount: Object.keys(state.keys).length };
}

export function runImport(opts: RunImportOptions): RunImportResult {
  const det = detect(opts.projectRoot, opts.format);
  if (!det) throw new Error(`No recognized locale files found in ${opts.projectRoot}`);

  const parser = getParser(det.format);
  const parsed = parser.parse(
    det.localeRoot,
    opts.locales ? { locales: opts.locales } : undefined,
  );

  const assembled = assemble(parsed, {
    sourceLocale: opts.sourceLocale ?? det.sourceLocale,
    format: det.format,
    cldr: opts.cldr,
    localeRootRel: relative(opts.projectRoot, det.localeRoot),
  });

  const { warnings, ...rest } = assembled;
  const state = validate(rest);

  return {
    state,
    warnings,
    keyCount: Object.keys(state.keys).length,
    localeCount: state.config.locales.length,
  };
}
