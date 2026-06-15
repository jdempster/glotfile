import type { Config, LintSeverity, OutputConfig, ScanConfig } from "@/types.js";
import { RULE_DEFAULTS } from "@/lint-rules.js";

export interface OutputForm {
  adapter: string;
  path: string;
  // null/undefined on indent/finalNewline means "inherit the global Format default".
  emptyAs?: "source" | "empty" | "omit";
  style?: "nested" | "flat";
  indent?: number | null;
  finalNewline?: boolean | null;
  includeLocale?: boolean;
  skipSourceLocale?: boolean;
  localeAliases?: Record<string, string[]>;
  localeCase?: "lower-hyphen" | "lower-underscore" | "bcp47-hyphen" | "bcp47-underscore";
  localeMap?: Record<string, string>;
}

export interface ConfigForm {
  sourceLocale: string;
  locales: string[];
  outputs: OutputForm[];
  indent: number | string;
  sortKeys: boolean;
  finalNewline: boolean;
  autoExport: boolean;
  // Export-language limit (for testing). Empty = no limit (export all locales).
  exportLocales: string[];
  customWords: string[];
  // config.lint — the full effective severity per rule (defaults overlaid with
  // config.lint.rules); only deviations from the defaults are persisted.
  lintRules: Record<string, LintSeverity>;
  lintIgnore: string[];
  // config.scan — all empty by default (auto-detection needs no config).
  scanAccessors: string[];
  scanPatterns: string[];
  scanInclude: string[];
  scanExclude: string[];
  scanKeep: string[];
}

// Number inputs hand us strings; coerce while tolerating "" / NaN with a fallback.
function toNumber(value: number | string, fallback: number): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function configToForm(config: Config): ConfigForm {
  return {
    sourceLocale: config.sourceLocale,
    locales: [...config.locales],
    outputs: config.outputs.map((o) => ({
      adapter: o.adapter,
      path: o.path,
      emptyAs: o.emptyAs,
      style: o.style === "flat" ? "flat" : "nested",
      indent: o.indent ?? null,
      finalNewline: o.finalNewline ?? null,
      includeLocale: o.includeLocale ?? true,
      skipSourceLocale: o.skipSourceLocale ?? false,
      localeAliases: o.localeAliases ? structuredClone(o.localeAliases) : {},
      localeCase: o.localeCase,
      localeMap: o.localeMap ? structuredClone(o.localeMap) : {},
    })),
    indent: config.format.indent,
    sortKeys: config.format.sortKeys,
    finalNewline: config.format.finalNewline,
    autoExport: config.autoExport ?? true,
    exportLocales: [...(config.exportLocales ?? [])],
    customWords: [...(config.spelling?.customWords ?? [])],
    lintRules: { ...RULE_DEFAULTS, ...config.lint?.rules },
    lintIgnore: [...(config.lint?.ignore ?? [])],
    scanAccessors: [...(config.scan?.accessors ?? [])],
    scanPatterns: [...(config.scan?.patterns ?? [])],
    scanInclude: [...(config.scan?.include ?? [])],
    scanExclude: [...(config.scan?.exclude ?? [])],
    scanKeep: [...(config.scan?.keep ?? [])],
  };
}

// `original` carries through config sections the form doesn't model (lint, storage), so a
// Settings save never silently drops them — PUT /config replaces the whole config.
export function formToConfig(form: ConfigForm, original?: Config): Config {
  const outputs: OutputConfig[] = form.outputs
    .map((o) => {
      const out: OutputConfig = { adapter: o.adapter.trim(), path: o.path.trim() };
      if (o.style === "flat") out.style = "flat";
      if (o.emptyAs) out.emptyAs = o.emptyAs;
      if (o.indent != null) out.indent = o.indent;
      if (o.finalNewline != null) out.finalNewline = o.finalNewline;
      // @@locale defaults on (exporter reads `?? true`), so only the off case is persisted.
      if (!o.includeLocale) out.includeLocale = false;
      if (o.skipSourceLocale) out.skipSourceLocale = true;
      if (o.localeAliases && Object.keys(o.localeAliases).length) {
        out.localeAliases = Object.fromEntries(
          Object.entries(o.localeAliases).filter(([, codes]) => codes.length > 0),
        );
        if (Object.keys(out.localeAliases).length === 0) delete out.localeAliases;
      }
      if (o.localeCase) out.localeCase = o.localeCase;
      if (o.localeMap) {
        const map = Object.fromEntries(
          Object.entries(o.localeMap).filter(([, v]) => v.trim() !== ""),
        );
        if (Object.keys(map).length) out.localeMap = map;
      }
      return out;
    })
    .filter((o) => o.adapter || o.path);

  // Only the non-empty arrays land in config.scan; drop the section entirely when
  // nothing is set (auto-detection covers the empty case).
  const scan: ScanConfig = {};
  if (form.scanAccessors.length) scan.accessors = [...form.scanAccessors];
  if (form.scanPatterns.length) scan.patterns = [...form.scanPatterns];
  if (form.scanInclude.length) scan.include = [...form.scanInclude];
  if (form.scanExclude.length) scan.exclude = [...form.scanExclude];
  if (form.scanKeep.length) scan.keep = [...form.scanKeep];

  const config: Config = {
    sourceLocale: form.sourceLocale,
    locales: [...form.locales],
    outputs,
    format: {
      indent: toNumber(form.indent, 2),
      sortKeys: form.sortKeys,
      finalNewline: form.finalNewline,
    },
    autoExport: form.autoExport,
    // Persist the limit only when it actually narrows; empty = no limit (omit the key).
    ...(form.exportLocales.length ? { exportLocales: [...form.exportLocales] } : {}),
    spelling: { customWords: [...form.customWords] },
    ...(Object.keys(scan).length ? { scan } : {}),
  };

  // config.lint: persist only severities that deviate from the built-in defaults,
  // plus ignore globs. lint.spelling (per-locale dictionary ids) isn't modeled by
  // the form, so it's carried through from the loaded config.
  const ruleOverrides = Object.fromEntries(
    Object.entries(form.lintRules).filter(([id, sev]) => RULE_DEFAULTS[id] !== undefined && sev !== RULE_DEFAULTS[id]),
  );
  const lint: NonNullable<Config["lint"]> = {};
  if (Object.keys(ruleOverrides).length) lint.rules = ruleOverrides;
  if (form.lintIgnore.length) lint.ignore = [...form.lintIgnore];
  if (original?.lint?.spelling !== undefined) lint.spelling = original.lint.spelling;
  if (Object.keys(lint).length) config.lint = lint;

  // Passthrough allow-list for config the form doesn't own.
  if (original?.storage !== undefined) config.storage = original.storage;

  return config;
}
