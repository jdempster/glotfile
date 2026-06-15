import { relative } from "node:path";
import { detect } from "./detect.js";
import { getParser } from "./parsers/index.js";
import { assemble } from "./assemble.js";
import { mergeStates, type SyncPlan } from "./merge.js";
import { loadState } from "../state.js";
import { validate } from "../schema.js";
import type { State } from "../schema.js";

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
