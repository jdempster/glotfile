import type { State, KeyEntry } from "./schema.js";

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

// Whitespace tokenization. Placeholders/ICU count as words — a deliberate sizing
// approximation, never a billing figure (see spec §10).
export function countWords(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

// Namespace = the key segment before the first dot; dotless keys group together.
export function namespaceOf(key: string): string {
  const i = key.indexOf(".");
  return i === -1 ? "(root)" : key.slice(0, i);
}

// One-decimal percentage; 0 when there is nothing to measure.
export function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

// --- internal helpers -------------------------------------------------------

// Source text used for word counting; for plural keys the representative `other`
// form (matches the presence rule below, avoids inflating counts across forms).
function sourceText(entry: KeyEntry, sourceLocale: string): string {
  const lv = entry.values[sourceLocale];
  if (!lv) return "";
  return entry.plural ? (lv.forms?.other ?? "") : (lv.value ?? "");
}

// A locale is "present" for a key when it has a non-blank usable value.
function isPresent(entry: KeyEntry, locale: string): boolean {
  const lv = entry.values[locale];
  if (!lv) return false;
  return entry.plural
    ? (lv.forms?.other ?? "").trim() !== ""
    : (lv.value ?? "").trim() !== "";
}

// Which Counts bucket a (key, locale) cell falls into.
function classify(entry: KeyEntry, locale: string): keyof Counts {
  if (!isPresent(entry, locale)) return "missing";
  const st = entry.values[locale]!.state;
  if (st === "reviewed") return "reviewed";
  if (st === "needs-review") return "needsReview";
  return "machine";
}

function groupCompletion(state: State, keys: string[], targets: string[], name: string): GroupStats {
  let translated = 0;
  let reviewed = 0;
  for (const k of keys) {
    const entry = state.keys[k]!;
    for (const locale of targets) {
      const bucket = classify(entry, locale);
      if (bucket !== "missing") translated++;
      if (bucket === "reviewed") reviewed++;
    }
  }
  const cells = keys.length * targets.length;
  return { name, total: keys.length, translatedPct: pct(translated, cells), reviewedPct: pct(reviewed, cells) };
}

// Worst-first (lowest translated %), then alphabetical for stable ordering.
function worstFirst(a: GroupStats, b: GroupStats): number {
  return a.translatedPct - b.translatedPct || a.name.localeCompare(b.name);
}

// --- public engine ----------------------------------------------------------

export function computeStats(state: State): Stats {
  const { sourceLocale, locales } = state.config;
  const targets = locales.filter((l) => l !== sourceLocale);

  const allKeys = Object.keys(state.keys);
  const expected = allKeys.filter((k) => !state.keys[k]!.skipTranslate);

  const locales_: LocaleStats[] = targets.map((locale) => {
    const counts: Counts = { reviewed: 0, needsReview: 0, machine: 0, missing: 0 };
    let sourceWords = 0;
    let missingWords = 0;
    for (const k of expected) {
      const entry = state.keys[k]!;
      const w = countWords(sourceText(entry, sourceLocale));
      sourceWords += w;
      const bucket = classify(entry, locale);
      counts[bucket]++;
      if (bucket === "missing") missingWords += w;
    }
    const total = expected.length;
    const translated = counts.reviewed + counts.needsReview + counts.machine;
    return {
      locale,
      total,
      counts,
      translated,
      reviewed: counts.reviewed,
      translatedPct: pct(translated, total),
      reviewedPct: pct(counts.reviewed, total),
      words: { source: sourceWords, missing: missingWords },
    };
  });

  // Micro-average across every expected (key, locale) cell.
  const cells = expected.length * targets.length;
  let translatedCells = 0;
  let reviewedCells = 0;
  for (const ls of locales_) {
    translatedCells += ls.translated;
    reviewedCells += ls.reviewed;
  }

  // Namespace groups.
  const nsMap = new Map<string, string[]>();
  for (const k of expected) {
    const ns = namespaceOf(k);
    (nsMap.get(ns) ?? nsMap.set(ns, []).get(ns)!).push(k);
  }
  const byNamespace = [...nsMap.entries()]
    .map(([name, keys]) => groupCompletion(state, keys, targets, name))
    .sort(worstFirst);

  // Tag groups (a key fans out to each of its tags; untagged keys are omitted).
  const tagMap = new Map<string, string[]>();
  for (const k of expected) {
    for (const tag of state.keys[k]!.tags ?? []) {
      (tagMap.get(tag) ?? tagMap.set(tag, []).get(tag)!).push(k);
    }
  }
  const byTag = [...tagMap.entries()]
    .map(([name, keys]) => groupCompletion(state, keys, targets, name))
    .sort(worstFirst);

  return {
    totals: {
      keys: allKeys.length,
      locales: targets.length,
      translatedPct: pct(translatedCells, cells),
      reviewedPct: pct(reviewedCells, cells),
      sourceWords: expected.reduce((sum, k) => sum + countWords(sourceText(state.keys[k]!, sourceLocale)), 0),
    },
    locales: locales_,
    byNamespace,
    byTag,
  };
}
