export type LocaleState = "source" | "machine" | "reviewed" | "needs-review";
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
// An ICU plural branch selector: a CLDR category, or an explicit value match (=1).
// Mirrors the server's PluralForm.
export type ExactSelector = `=${number}`;
export type PluralForm = PluralCategory | ExactSelector;
// A scalar key carries `value`; a plural key carries `forms` (one per selector).
export interface LocaleValue {
  value?: string;
  forms?: Partial<Record<PluralForm, string>>;
  state: LocaleState;
  source?: string;
}
export interface Note { id: string; text: string; at: string }
export interface PlaceholderMeta { type?: string; format?: string; example?: string }
export interface KeyEntry {
  context?: string; contextSource?: "ai";
  notes?: Note[]; tags?: string[]; maxLength?: number; description?: string;
  screenshot?: string; skipTranslate?: boolean; createdAt?: string;
  plural?: { arg: string };
  placeholders?: Record<string, PlaceholderMeta>;
  values: Record<string, LocaleValue>;
}

export interface GlossaryEntry {
  term: string;
  doNotTranslate?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  translations?: Record<string, string>;
  notes?: string;
}

export interface GlossarySuggestion {
  term: string;
  note?: string;
  doNotTranslate?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  status: "pending" | "dismissed";
  occurrences?: number;
}

export interface OutputConfig {
  adapter: string;
  path: string;
  style?: string;
  emptyAs?: "source" | "empty" | "omit";
  indent?: number;
  finalNewline?: boolean;
  includeLocale?: boolean;
  skipSourceLocale?: boolean;
  localeAliases?: Record<string, string[]>;
  localeCase?: "lower-hyphen" | "lower-underscore" | "bcp47-hyphen" | "bcp47-underscore";
  localeMap?: Record<string, string>;
}

export interface ScanConfig {
  include?: string[];
  exclude?: string[];
  accessors?: string[];
  patterns?: string[];
  // Key globs always treated as used (consumed by code the scanner can't see).
  keep?: string[];
}

// AI settings live in local (per-developer, gitignored) settings, not the committed
// config — see LocalSettings / the /local-settings API.
export interface AiSettings { provider: string; model: string; endpoint: string | null; region?: string | null; batchSize: number; concurrency?: number; vision?: boolean; promptStyle?: string; contextBatchSize?: number; contextConcurrency?: number; inputPricePerMTok?: number; outputPricePerMTok?: number; }
export interface LocalSettings { ai: AiSettings; editor: string; profiles?: Record<string, AiSettings>; activeProfile?: string | null }

export interface LocaleEstimate { locale: string; requests: number; batches: number; inputTokens: number; outputTokens: number }
export interface TranslateEstimate {
  requests: number;
  batches: number;
  perLocale: LocaleEstimate[];
  inputTokens: number;
  outputTokens: number;
  pricing: { source: "builtin" | "profile"; inputPerMTok: number; outputPerMTok: number } | null;
  estimatedCost: number | null;
}

export interface ContextEstimate {
  keys: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
  pricing: { source: "builtin" | "profile"; inputPerMTok: number; outputPerMTok: number } | null;
  estimatedCost: number | null;
}

export interface Config {
  sourceLocale: string;
  locales: string[];
  outputs: OutputConfig[];
  format: { indent: number; sortKeys: boolean; finalNewline: boolean };
  autoExport?: boolean;
  // Optional allow-list narrowing which locales every export writes. Empty/absent = all.
  exportLocales?: string[];
  spelling?: { customWords: string[] };
  scan?: ScanConfig;
  lint?: LintConfig;
  // On-disk layout; not modeled by the Settings form, carried through saves.
  storage?: "single" | "split";
}

export type LintSeverity = "error" | "warn" | "off";
export interface LintConfig {
  rules?: Record<string, LintSeverity>;
  ignore?: string[];
  // Per-locale dictionary overrides — not modeled by the Settings form, carried through saves.
  spelling?: { locales?: Record<string, string> };
}

export interface State {
  version: number;
  config: Config;
  keys: Record<string, KeyEntry>;
}

export interface ExportFile { path: string; contents: string }
export interface ExportPreview { files: ExportFile[]; warnings: string[] }
export interface ExportResult { files: number; warnings: string[] }

export interface TranslateError { key: string; locale: string; error: string }
export interface TranslateResult { requested: number; written: number; errors: TranslateError[] }

export interface BatchCounts { processing: number; succeeded: number; errored: number; canceled: number; expired: number }
export interface BatchPending {
  batchId: string;
  createdAt: string;
  model: string;
  total: number;
  status: "in_progress" | "canceling" | "ended" | "unknown";
  counts: BatchCounts | null;
  error?: string;
}
export interface BatchStatusResponse { supported: boolean; pending: BatchPending | null }
export interface BatchApplyResult {
  written: number;
  errors: TranslateError[];
  staleSkipped: number;
  retried: number;
  screenshotsSkipped: number;
}
export interface ContextBatchApplyResult {
  written: number;
  errors: { key: string; error: string }[];
  retried: number;
}
export interface GlossarySuggestEstimate {
  sources: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number | null;
}
export interface GlossarySuggestBatchApplyResult {
  added: number;
  errors: { error: string }[];
  retried: number;
}
// Emitted once before any work: the full plan, so the UI can render every
// target language as "queued" up front.
export interface TranslateStart { type: "start"; total: number; locales: { locale: string; total: number }[] }
// A language has just gone in-flight (a worker picked it up).
export interface TranslateLocaleStart { type: "locale-start"; locale: string }
export interface TranslateProgress { type: "progress"; done: number; total: number; written: number; errors: TranslateError[]; locale: string; localeDone: number; localeTotal: number }
// A language's whole group has finished.
export interface TranslateLocaleDone { type: "locale-done"; locale: string }
export interface TranslateDone { type: "done"; written: number; errors: TranslateError[] }

export interface GlossaryHint { term: string; doNotTranslate?: boolean; forced?: string; notes?: string }

export type LogKind =
  | "translation" | "key" | "metadata" | "config"
  | "glossary" | "note" | "dictionary" | "import"
  | "translate" | "context";

// One activity-log entry. General edits carry a before/after audit pair; AI
// operations (kind translate/context) additionally carry the prompt and results.
export interface LogEntry {
  at: string;
  kind: LogKind;
  summary: string;
  key?: string;
  locale?: string;
  before?: unknown;
  after?: unknown;
  // AI-only:
  model?: string;
  system?: string;
  items?: {
    id: string;
    key: string;
    source: string;
    targetLocale?: string;
    context?: string;
    glossary?: GlossaryHint[];
    screenshot?: string;
  }[];
  results?: { id: string; translation?: string; value?: string; forms?: Partial<Record<PluralCategory, string>>; error?: string }[];
}

export type CheckId = "untranslated" | "placeholder" | "spelling" | "length" | "glossary";
export interface Issue {
  key: string;
  locale: string;
  check: CheckId;
  message: string;
  detail?: string[];
}
export interface ChecksResponse {
  issues: Issue[];
  spellPending: boolean;
}

// The lint report from GET /lint — the exact same findings `glotfile check`
// produces (lint rules plus output drift), so the Analytics release gate and the
// CLI can never disagree. "output-stale" comes from the drift check, not a rule.
export type LintRuleId =
  | "empty-source" | "empty-translation" | "placeholder-mismatch" | "icu-mismatch"
  | "glossary-violation" | "max-length" | "identical-to-source" | "whitespace"
  | "spelling" | "output-stale";
export interface LintFinding {
  ruleId: LintRuleId;
  key: string;
  // Empty string for project-level findings (empty-source, output-stale).
  locale: string;
  severity: "error" | "warn";
  message: string;
  // True only when the report was fetched with includeSuppressed.
  suppressed?: boolean;
}
export interface LintReport {
  findings: LintFinding[];
  counts: { error: number; warn: number; suppressed: number };
  ok: boolean;
}

export interface Counts {
  reviewed: number;
  needsReview: number;
  machine: number;
  missing: number;
}

export interface LocaleStats {
  locale: string;
  total: number;
  counts: Counts;
  translated: number;
  reviewed: number;
  translatedPct: number;
  reviewedPct: number;
  words: { source: number; missing: number };
}

export interface GroupStats {
  name: string;
  total: number;
  translatedPct: number;
  reviewedPct: number;
}

export interface Stats {
  totals: {
    keys: number;
    locales: number;
    translatedPct: number;
    reviewedPct: number;
    sourceWords: number;
  };
  locales: LocaleStats[];
  byNamespace: GroupStats[];
  byTag: GroupStats[];
}
