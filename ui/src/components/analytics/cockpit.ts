import type { State, KeyEntry, CheckId, LintFinding, LintReport, LintRuleId } from "@/types.js";
import type { KeyFilter } from "@/filter.js";

export type Severity = "breaking" | "warning";
export type Verdict = "ready" | "almost" | "blocked";

// Human labels for lint rule ids (plus the output drift check).
export const RULE_LABELS: Record<LintRuleId, string> = {
  "empty-source": "Empty source",
  "empty-translation": "Untranslated",
  "placeholder-mismatch": "Placeholder mismatch",
  "icu-mismatch": "ICU mismatch",
  "glossary-violation": "Glossary",
  "max-length": "Too long",
  "identical-to-source": "Identical to source",
  "whitespace": "Whitespace",
  "spelling": "Spelling",
  "output-stale": "Outputs out of date",
};

// Rules the editor's live-check filter understands; the rest drill to the key.
const RULE_TO_CHECK: Partial<Record<LintRuleId, CheckId>> = {
  "empty-translation": "untranslated",
  "placeholder-mismatch": "placeholder",
  "glossary-violation": "glossary",
  "max-length": "length",
  "spelling": "spelling",
  "icu-mismatch": "icu",
  "whitespace": "whitespace",
  "identical-to-source": "identical",
};

export function drillFilterFor(f: LintFinding): Partial<KeyFilter> {
  if (f.ruleId === "empty-translation") return { text: f.key, states: ["missing"] };
  if (f.ruleId === "output-stale") return {};
  const check = RULE_TO_CHECK[f.ruleId];
  const base: Partial<KeyFilter> = f.locale ? { locale: f.locale } : {};
  if (check) return { ...base, issues: [check] };
  return { ...base, text: f.key };
}

export interface LocaleReadiness {
  locale: string;
  total: number;
  translated: number;
  pct: number;
  counts: { reviewed: number; needsReview: number; machine: number; missing: number };
  // Keys this locale's empty-translation findings point at (the release gate's
  // "missing" dimension; empty when the rule is configured off).
  missingKeys: string[];
  // "Stale" = needs-review: glotfile downgrades a target to needs-review when its source changes.
  staleKeys: string[];
  // Locale-scoped lint findings behind the breaking/warning counts (for drilldown).
  errors: LintFinding[];
  warnings: LintFinding[];
  breaking: number;
  warning: number;
  verdict: Verdict;
  blockers: string[];
  notes: string[];
}

export interface WorkItem {
  id: string;
  priority: Severity | "missing" | "stale";
  title: string;
  where: string;
  detail: string;
  // Absent when the finding has no editor representation (e.g. stale outputs).
  filter?: Partial<KeyFilter>;
  count: number;
}

export interface Cockpit {
  totals: {
    keys: number; locales: number; translatedPct: number; reviewedPct: number;
    sourceWords: number; openIssues: number;
    ready: number; almost: number; blocked: number;
    breaking: number; missing: number; stale: number;
  };
  // Project-level findings (locale === ""): empty sources, stale output files.
  // Any error among them blocks the release regardless of per-locale readiness.
  project: LintFinding[];
  projectErrors: number;
  locales: LocaleReadiness[];
  risk: Record<Severity, LintFinding[]>;
  worklist: WorkItem[];
}

// A locale has a usable value for a key when its scalar value (or plural "other") is non-blank.
function isPresent(entry: KeyEntry, locale: string): boolean {
  const lv = entry.values[locale];
  if (!lv) return false;
  return entry.plural ? (lv.forms?.other ?? "").trim() !== "" : (lv.value ?? "").trim() !== "";
}

function classify(entry: KeyEntry, locale: string): keyof LocaleReadiness["counts"] {
  if (!isPresent(entry, locale)) return "missing";
  const st = entry.values[locale]!.state;
  if (st === "reviewed") return "reviewed";
  if (st === "needs-review") return "needsReview";
  return "machine";
}

function sourceText(entry: KeyEntry, sourceLocale: string): string {
  const lv = entry.values[sourceLocale];
  if (!lv) return "";
  return entry.plural ? (lv.forms?.other ?? "") : (lv.value ?? "");
}

function countWords(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function buildCockpit(state: State, report: LintReport): Cockpit {
  const { sourceLocale, locales } = state.config;
  const targets = locales.filter((l) => l !== sourceLocale);
  const expected = Object.keys(state.keys).filter((k) => !state.keys[k]!.skipTranslate);

  // The gate is the lint report — the same findings `glotfile check` emits, with
  // the same config.lint.rules skips. empty-translation findings form the
  // "missing" dimension; every other error is a breaking content issue.
  const project = report.findings.filter((f) => f.locale === "");
  const projectErrors = project.filter((f) => f.severity === "error").length;
  const byLocale = new Map<string, LintFinding[]>();
  for (const f of report.findings) {
    if (f.locale === "") continue;
    const arr = byLocale.get(f.locale);
    if (arr) arr.push(f);
    else byLocale.set(f.locale, [f]);
  }

  const localesOut: LocaleReadiness[] = targets.map((locale) => {
    const counts = { reviewed: 0, needsReview: 0, machine: 0, missing: 0 };
    const staleKeys: string[] = [];
    for (const k of expected) {
      const bucket = classify(state.keys[k]!, locale);
      counts[bucket]++;
      if (bucket === "needsReview") staleKeys.push(k);
    }
    const findings = byLocale.get(locale) ?? [];
    const missingKeys = [...new Set(findings.filter((f) => f.ruleId === "empty-translation").map((f) => f.key))];
    const errors = findings.filter((f) => f.severity === "error" && f.ruleId !== "empty-translation");
    const warnings = findings.filter((f) => f.severity === "warn");
    const total = expected.length;
    const translated = counts.reviewed + counts.needsReview + counts.machine;

    let verdict: Verdict;
    if (missingKeys.length > 0 || errors.length > 0) verdict = "blocked";
    else if (staleKeys.length > 0) verdict = "almost";
    else verdict = "ready";

    const blockers: string[] = [];
    if (missingKeys.length) blockers.push(`${missingKeys.length} missing`);
    if (errors.length) blockers.push(`${errors.length} breaking`);
    if (staleKeys.length) blockers.push(`${staleKeys.length} stale`);
    const notes: string[] = [];
    if (warnings.length) notes.push(plural(warnings.length, "warning"));

    return {
      locale, total, translated,
      pct: total ? Math.round((translated / total) * 100) : 0,
      counts, missingKeys, staleKeys, errors, warnings,
      breaking: errors.length, warning: warnings.length,
      verdict, blockers, notes,
    };
  });

  // Aggregate completion across every expected (key, locale) cell (micro-average).
  const cells = expected.length * targets.length;
  let translatedCells = 0, reviewedCells = 0;
  for (const l of localesOut) { translatedCells += l.translated; reviewedCells += l.counts.reviewed; }
  const sourceWords = expected.reduce((sum, k) => sum + countWords(sourceText(state.keys[k]!, sourceLocale)), 0);

  // Content risk excludes empty-translation (that's completion, shown as "missing").
  const risk: Record<Severity, LintFinding[]> = { breaking: [], warning: [] };
  for (const f of report.findings) {
    if (f.ruleId === "empty-translation") continue;
    risk[f.severity === "error" ? "breaking" : "warning"].push(f);
  }

  const totals = {
    keys: Object.keys(state.keys).length,
    locales: targets.length,
    translatedPct: cells ? Math.round((translatedCells / cells) * 1000) / 10 : 0,
    reviewedPct: cells ? Math.round((reviewedCells / cells) * 1000) / 10 : 0,
    sourceWords,
    openIssues: risk.breaking.length + risk.warning.length,
    ready: localesOut.filter((l) => l.verdict === "ready").length,
    almost: localesOut.filter((l) => l.verdict === "almost").length,
    blocked: localesOut.filter((l) => l.verdict === "blocked").length,
    breaking: risk.breaking.length,
    missing: localesOut.reduce((a, l) => a + l.missingKeys.length, 0),
    stale: localesOut.reduce((a, l) => a + l.staleKeys.length, 0),
  };

  return { totals, project, projectErrors, locales: localesOut, risk, worklist: buildWorklist(localesOut, risk) };
}

// Prioritized — the single most valuable action first: breaking → missing → stale → warning.
function buildWorklist(localesOut: LocaleReadiness[], risk: Record<Severity, LintFinding[]>): WorkItem[] {
  const work: WorkItem[] = [];

  for (const f of risk.breaking) {
    work.push({
      id: `b:${f.locale}:${f.key}:${f.ruleId}`,
      priority: "breaking",
      title: `Fix ${RULE_LABELS[f.ruleId].toLowerCase()}`,
      where: f.locale ? `${f.locale.toUpperCase()} · ${f.key}` : f.key,
      detail: f.message,
      filter: f.ruleId === "output-stale" ? undefined : drillFilterFor(f),
      count: 1,
    });
  }

  const missByKey = new Map<string, string[]>();
  for (const l of localesOut) for (const k of l.missingKeys) {
    const arr = missByKey.get(k);
    if (arr) arr.push(l.locale);
    else missByKey.set(k, [l.locale]);
  }
  for (const [key, locs] of missByKey) {
    work.push({
      id: `m:${key}`,
      priority: "missing",
      title: `Translate ${plural(locs.length, "missing string")}`,
      where: key,
      detail: `Missing in ${locs.map((x) => x.toUpperCase()).join(", ")}`,
      filter: { text: key, states: ["missing"] },
      count: locs.length,
    });
  }

  const staleItems: { locale: string; key: string }[] = [];
  for (const l of localesOut) for (const k of l.staleKeys) staleItems.push({ locale: l.locale, key: k });
  if (staleItems.length) {
    work.push({
      id: "s:all",
      priority: "stale",
      title: `Refresh ${plural(staleItems.length, "stale translation")}`,
      where: "source changed since translated",
      detail: staleItems.map((s) => `${s.locale.toUpperCase()} · ${s.key}`).join("   ·   "),
      filter: { states: ["needs-review"] },
      count: staleItems.length,
    });
  }

  const warnByRule = new Map<LintRuleId, LintFinding[]>();
  for (const f of risk.warning) {
    const arr = warnByRule.get(f.ruleId);
    if (arr) arr.push(f);
    else warnByRule.set(f.ruleId, [f]);
  }
  for (const [ruleId, list] of warnByRule) {
    work.push({
      id: `w:${ruleId}`,
      priority: "warning",
      title: `Review ${plural(list.length, `${RULE_LABELS[ruleId].toLowerCase()} warning`)}`,
      where: [...new Set(list.map((f) => f.locale.toUpperCase() || f.key))].join(", "),
      detail: list.map((f) => `${f.locale ? f.locale.toUpperCase() : "—"} · ${f.key}`).join("   ·   "),
      filter: drillFilterFor(list[0]!),
      count: list.length,
    });
  }

  return work;
}
