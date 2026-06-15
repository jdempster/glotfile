import { RULE_IDS, type Severity, type RuleId } from "./lint/registry.js";

// The single, current on-disk data version. Nothing is released, so there is no
// migration chain — every save stamps this and validate() accepts any number.
export const CURRENT_VERSION = 1;

export type LocaleState = "source" | "machine" | "reviewed" | "needs-review";
export const STATES: readonly LocaleState[] = ["source", "machine", "reviewed", "needs-review"];

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export const PLURAL_CATEGORIES: readonly PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

// An ICU plural branch selector: a CLDR keyword category, or an explicit value
// match like "=0"/"=1". Exact selectors take precedence over categories at
// runtime and are the only way to special-case a literal count in a locale whose
// CLDR rules lack the matching category (e.g. "=1" in ja/zh, which have no "one").
export type ExactSelector = `=${number}`;
export type PluralForm = PluralCategory | ExactSelector;
const EXACT_SELECTOR_RE = /^=\d+$/;
export function isPluralForm(key: string): boolean {
  return (PLURAL_CATEGORIES as readonly string[]).includes(key) || EXACT_SELECTOR_RE.test(key);
}

export interface LocaleValue {
  // Scalar keys carry `value`; plural keys carry `forms` (one per ICU selector).
  // Exactly one is present, decided by the owning KeyEntry.plural marker.
  value?: string;
  forms?: Partial<Record<PluralForm, string>>;
  state: LocaleState;
  source?: string;
  updatedAt?: string;
}

export interface Note {
  id: string;
  text: string;
  at: string;
}

export interface PlaceholderMeta {
  type?: string;
  format?: string;
  example?: string;
  // Set to "x" when the placeholder was captured from an Angular <x/> element
  // whose id is NOT a SCREAMING_SNAKE convention name (INTERPOLATION, PH, …) —
  // e.g. a user-named $localize placeholder (`${expr}:displayName:`). It tells
  // the angular-xliff export to reproduce the element with this exact id rather
  // than falling back to the generic INTERPOLATION id, which Angular rejects as
  // a placeholder mismatch.
  origin?: "x";
}

// A dismissed lint finding for one (rule, locale) on this key. `source` is the
// hash of the key's source content when dismissed (see lint/suppress.ts), so the
// suppression silently expires when the source string changes.
export interface Suppression {
  rule: RuleId;
  locale: string;
  source: string;
  at?: string;
}

export interface KeyEntry {
  context?: string;
  contextSource?: "ai";
  contextAt?: string;
  notes?: Note[];
  tags?: string[];
  maxLength?: number;
  description?: string;
  screenshot?: string;
  skipTranslate?: boolean;
  createdAt?: string;
  // Presence marks the key as a plural message; `arg` is the count token name.
  plural?: { arg: string };
  // Typed placeholder metadata (ARB type/format/example), keyed by placeholder name.
  placeholders?: Record<string, PlaceholderMeta>;
  suppressions?: Suppression[];
  values: Record<string, LocaleValue>;
}

export const LOCALE_CASES = ["lower-hyphen", "lower-underscore", "bcp47-hyphen", "bcp47-underscore"] as const;
export type LocaleCase = (typeof LOCALE_CASES)[number];

export interface OutputConfig {
  adapter: string;
  path: string;
  style?: string;
  emptyAs?: "source" | "empty" | "omit";
  indent?: number;
  finalNewline?: boolean;
  includeLocale?: boolean;
  // Don't write a file for the source locale. For formats where a generator owns
  // the source file (Angular's ng extract-i18n writes messages.xlf), glotfile
  // exports only the translation files.
  skipSourceLocale?: boolean;
  localeAliases?: Record<string, string[]>;
  // Blanket locale-code rendering style for this output's {locale} path token and
  // any in-file locale token. Unset => the adapter's default.
  localeCase?: LocaleCase;
  // Per-locale exact override (canonical code -> export token). Wins over localeCase.
  localeMap?: Record<string, string>;
}
export const PROVIDERS = ["anthropic", "openai", "bedrock", "openrouter", "ollama", "claude-code"] as const;
export type AiProvider = (typeof PROVIDERS)[number];
export const PROMPT_STYLES = ["default", "translategemma"] as const;
export type PromptStyle = (typeof PROMPT_STYLES)[number];
export interface AiConfig {
  provider: AiProvider;
  model: string;
  endpoint: string | null;
  region?: string | null;
  batchSize: number;
  // How many locales to translate in parallel. Defaults to DEFAULT_LOCALE_CONCURRENCY (3).
  concurrency?: number;
  vision?: boolean;
  promptStyle?: PromptStyle;
  // Per-operation overrides for context builds (fall back to batchSize / concurrency when absent).
  contextBatchSize?: number;
  contextConcurrency?: number;
  // Optional $ per 1M tokens for cost estimates. When BOTH are set they override
  // the built-in price table (covers OpenRouter's long tail / custom endpoints).
  inputPricePerMTok?: number;
  outputPricePerMTok?: number;
}
export interface FormatConfig { indent: number; sortKeys: boolean; finalNewline: boolean }
export interface SpellingConfig { customWords: string[] }
export interface LintConfig {
  rules?: Record<string, Severity>;
  ignore?: string[];
  spelling?: { locales?: Record<string, string> };
}
export interface ScanConfig {
  include?: string[];
  exclude?: string[];
  // Extra Flutter accessor names the gen_l10n object is bound to (auto-detection
  // covers most projects; this is the escape hatch).
  accessors?: string[];
  // Custom usage-scan regexes (capture group 1 = key) applied to every file.
  patterns?: string[];
  // Key globs always treated as used — for keys consumed by code the scanner
  // can't see (framework internals, vendored packages, server-driven UIs).
  keep?: string[];
}
export interface Config {
  sourceLocale: string;
  locales: string[];
  outputs: OutputConfig[];
  format: FormatConfig;
  spelling?: SpellingConfig;
  lint?: LintConfig;
  scan?: ScanConfig;
  // When true (the default), `glotfile serve` re-exports to disk on every change.
  autoExport?: boolean;
  // Optional allow-list narrowing which locales every export writes. Empty/absent =
  // export all of `locales`. Persisted so the serve auto-export hook honours it too.
  exportLocales?: string[];
  // On-disk layout. "split" persists the catalog as a glotfile/ directory of
  // per-locale files; absent/"single" keeps the monolithic glotfile.json.
  storage?: "single" | "split";
}
export interface GlossaryEntry {
  term: string;
  doNotTranslate?: boolean;
  caseSensitive?: boolean;
  translations?: Record<string, string>;
  notes?: string;
}
export interface State {
  $schema?: string;
  version: number;
  config: Config;
  glossary: GlossaryEntry[];
  keys: Record<string, KeyEntry>;
}

export class GlotfileError extends Error {}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function fail(msg: string): never {
  throw new GlotfileError(msg);
}

export function validate(raw: unknown): State {
  if (!isObject(raw)) fail("glotfile.json must be a JSON object");
  if (typeof raw.version !== "number") fail("version must be a number");
  const config = raw.config;
  if (!isObject(config)) fail("config must be an object");
  if (typeof config.sourceLocale !== "string") fail("config.sourceLocale must be a string");
  if (!Array.isArray(config.locales) || !config.locales.every((l) => typeof l === "string")) {
    fail("config.locales must be an array of strings");
  }
  const locales = config.locales as string[];
  if (!locales.includes(config.sourceLocale)) {
    fail(`config.sourceLocale "${config.sourceLocale}" is not in config.locales`);
  }
  if (!Array.isArray(config.outputs)) fail("config.outputs must be an array");
  for (const o of config.outputs as unknown[]) {
    if (!isObject(o) || typeof o.adapter !== "string" || typeof o.path !== "string") {
      fail("each config.outputs entry needs string 'adapter' and 'path'");
    }
    if (o.style !== undefined && typeof o.style !== "string") fail("config.outputs[].style must be a string");
    if (o.emptyAs !== undefined && !["source", "empty", "omit"].includes(o.emptyAs as string)) {
      fail('config.outputs[].emptyAs must be "source", "empty", or "omit"');
    }
    if (o.indent !== undefined && typeof o.indent !== "number") fail("config.outputs[].indent must be a number");
    if (o.finalNewline !== undefined && typeof o.finalNewline !== "boolean") fail("config.outputs[].finalNewline must be a boolean");
    if (o.includeLocale !== undefined && typeof o.includeLocale !== "boolean") fail("config.outputs[].includeLocale must be a boolean");
    if (o.skipSourceLocale !== undefined && typeof o.skipSourceLocale !== "boolean") fail("config.outputs[].skipSourceLocale must be a boolean");
    if (o.localeAliases !== undefined) {
      if (!isObject(o.localeAliases)) fail("config.outputs[].localeAliases must be an object");
      for (const [k, v] of Object.entries(o.localeAliases)) {
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
          fail(`config.outputs[].localeAliases["${k}"] must be an array of strings`);
        }
      }
    }
    if (o.localeCase !== undefined && !(LOCALE_CASES as readonly string[]).includes(o.localeCase as string)) {
      fail('config.outputs[].localeCase must be one of "lower-hyphen", "lower-underscore", "bcp47-hyphen", "bcp47-underscore"');
    }
    if (o.localeMap !== undefined) {
      if (!isObject(o.localeMap)) fail("config.outputs[].localeMap must be an object");
      // Compare on canonical form so a hand-written "en_US" key still matches "en-us".
      const canon = (s: string) => s.trim().toLowerCase().replace(/_/g, "-");
      const localeSet = new Set(locales.map(canon));
      for (const [k, v] of Object.entries(o.localeMap)) {
        if (typeof v !== "string") fail(`config.outputs[].localeMap["${k}"] must be a string`);
        if (!localeSet.has(canon(k))) fail(`config.outputs[].localeMap key "${k}" is not in config.locales`);
      }
    }
  }
  if (!isObject(config.format)) fail("config.format must be an object");
  const fmt = config.format;
  if (typeof fmt.indent !== "number") fail("config.format.indent must be a number");
  if (typeof fmt.sortKeys !== "boolean") fail("config.format.sortKeys must be a boolean");
  if (typeof fmt.finalNewline !== "boolean") fail("config.format.finalNewline must be a boolean");
  if (config.autoExport !== undefined && typeof config.autoExport !== "boolean") fail("config.autoExport must be a boolean");
  if (config.exportLocales !== undefined &&
      (!Array.isArray(config.exportLocales) || !config.exportLocales.every((l) => typeof l === "string"))) {
    fail("config.exportLocales must be an array of strings");
  }
  if (config.storage !== undefined && config.storage !== "single" && config.storage !== "split") {
    fail('config.storage must be "single" or "split"');
  }
  if (config.spelling !== undefined) {
    const sp = config.spelling;
    if (!isObject(sp) || !Array.isArray(sp.customWords) || !sp.customWords.every((w) => typeof w === "string")) {
      fail("config.spelling.customWords must be an array of strings");
    }
  }

  if (config.lint !== undefined) {
    const lint = config.lint;
    if (!isObject(lint)) fail("config.lint must be an object");
    if (lint.rules !== undefined) {
      if (!isObject(lint.rules)) fail("config.lint.rules must be an object");
      for (const [id, sev] of Object.entries(lint.rules)) {
        if (!RULE_IDS.includes(id as RuleId)) fail(`config.lint.rules has unknown rule id "${id}"`);
        if (sev !== "error" && sev !== "warn" && sev !== "off") {
          fail(`config.lint.rules.${id} must be "error", "warn", or "off"`);
        }
      }
    }
    if (lint.ignore !== undefined && (!Array.isArray(lint.ignore) || !lint.ignore.every((g) => typeof g === "string"))) {
      fail("config.lint.ignore must be an array of strings");
    }
    if (lint.spelling !== undefined) {
      if (!isObject(lint.spelling)) fail("config.lint.spelling must be an object");
      if (lint.spelling.locales !== undefined &&
          (!isObject(lint.spelling.locales) || !Object.values(lint.spelling.locales).every((v) => typeof v === "string"))) {
        fail("config.lint.spelling.locales must be a map of strings");
      }
    }
  }

  if (config.scan !== undefined) {
    const scan = config.scan;
    if (!isObject(scan)) fail("config.scan must be an object");
    for (const f of ["include", "exclude", "accessors", "patterns", "keep"] as const) {
      const v = scan[f];
      if (v !== undefined && (!Array.isArray(v) || !v.every((x) => typeof x === "string"))) {
        fail(`config.scan.${f} must be an array of strings`);
      }
    }
    for (const p of (scan.patterns as string[] | undefined) ?? []) {
      try { new RegExp(p); } catch { fail(`config.scan.patterns has an invalid regex: ${p}`); }
    }
  }

  if (!isObject(raw.keys)) fail("keys must be an object");
  for (const [key, entry] of Object.entries(raw.keys)) {
    if (!isObject(entry)) fail(`key "${key}" must be an object`);
    if (!isObject(entry.values)) fail(`key "${key}" must have a values object`);
    const plural = entry.plural;
    if (plural !== undefined && (!isObject(plural) || typeof plural.arg !== "string" || !plural.arg)) {
      fail(`key "${key}" plural.arg must be a non-empty string`);
    }
    if (entry.placeholders !== undefined) {
      if (!isObject(entry.placeholders)) fail(`key "${key}" placeholders must be an object`);
      for (const [name, def] of Object.entries(entry.placeholders)) {
        if (!isObject(def)) fail(`key "${key}" placeholder "${name}" must be an object`);
        for (const f of ["type", "format", "example"] as const) {
          if (def[f] !== undefined && typeof def[f] !== "string") {
            fail(`key "${key}" placeholder "${name}".${f} must be a string`);
          }
        }
      }
    }
    for (const [loc, lv] of Object.entries(entry.values)) {
      if (!isObject(lv)) fail(`key "${key}" locale "${loc}" must be an object`);
      if (!STATES.includes(lv.state as LocaleState)) {
        fail(`key "${key}" locale "${loc}" has invalid state "${String(lv.state)}"`);
      }
      if (plural) {
        if (!isObject(lv.forms)) fail(`key "${key}" locale "${loc}" must have a forms object (plural key)`);
        for (const [cat, body] of Object.entries(lv.forms)) {
          if (!isPluralForm(cat)) {
            fail(`key "${key}" locale "${loc}" has invalid plural category "${cat}"`);
          }
          if (typeof body !== "string") fail(`key "${key}" locale "${loc}" form "${cat}" must be a string`);
        }
        if (typeof (lv.forms as Record<string, unknown>).other !== "string") {
          fail(`key "${key}" locale "${loc}" plural must include the "other" form`);
        }
      } else {
        if (typeof lv.value !== "string") fail(`key "${key}" locale "${loc}" value must be a string`);
        // Normalize on load: stored values never carry surrounding/whitespace-only content,
        // so legacy data folds to the same shape the setters produce on save.
        lv.value = lv.value.trim();
      }
    }
    if (entry.suppressions !== undefined) {
      if (!Array.isArray(entry.suppressions)) fail(`key "${key}" suppressions must be an array`);
      for (const s of entry.suppressions as unknown[]) {
        if (!isObject(s) || typeof s.locale !== "string" || typeof s.source !== "string") {
          fail(`key "${key}" has an invalid suppression (needs string rule, locale, source)`);
        }
        if (!RULE_IDS.includes(s.rule as RuleId)) {
          fail(`key "${key}" suppression has unknown rule id "${String(s.rule)}"`);
        }
        if (s.at !== undefined && typeof s.at !== "string") {
          fail(`key "${key}" suppression "at" must be a string`);
        }
      }
    }
    if (entry.notes !== undefined) {
      if (!Array.isArray(entry.notes)) fail(`key "${key}" notes must be an array`);
      for (const n of entry.notes as unknown[]) {
        if (!isObject(n) || typeof n.id !== "string" || typeof n.text !== "string" || typeof n.at !== "string") {
          fail(`key "${key}" has an invalid note (needs string id, text, at)`);
        }
      }
    }
    if (entry.contextSource !== undefined && entry.contextSource !== "ai") {
      fail(`key "${key}" contextSource must be "ai" if present`);
    }
    if (entry.contextAt !== undefined && typeof entry.contextAt !== "string") {
      fail(`key "${key}" contextAt must be a string if present`);
    }
  }
  if (raw.glossary !== undefined && !Array.isArray(raw.glossary)) fail("glossary must be an array");
  const state = { glossary: [], ...raw } as unknown as State;
  return state;
}

export function defaultState(): State {
  return {
    $schema: "https://glotfile.dev/schema/v1.json",
    version: CURRENT_VERSION,
    config: {
      sourceLocale: "en",
      locales: ["en"],
      outputs: [
        { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" },
        { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" },
      ],
      format: { indent: 2, sortKeys: true, finalNewline: true },
      spelling: { customWords: [] },
      autoExport: true,
    },
    glossary: [],
    keys: {},
  };
}
