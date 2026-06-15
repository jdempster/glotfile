import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { State } from "./schema.js";
import { writeFileAtomic } from "./atomic-write.js";
import { ensureGlotfileDir } from "./glotfile-dir.js";
import { globToRegExp } from "./glob.js";

export interface Reference {
  key: string;
  line: number;
  col: number;
  scanner: string;
}

export interface PrefixRef {
  prefix: string;
  line: number;
  col: number;
  scanner: string;
}

// A key-shaped string literal found outside a call site (ternary, array, variable
// assignment) — lower-confidence usage evidence matched against the catalog.
export interface LiteralRef {
  literal: string;
  line: number;
  col: number;
}

export interface UsageCacheFile {
  version: number;
  scannedAt: string;
  files: Record<string, {
    mtime: number;
    size: number;
    refs: Reference[];
    prefixes: PrefixRef[];
    literals?: LiteralRef[];
  }>;
}

export function loadUsageCache(projectRoot: string): UsageCacheFile | null {
  const path = resolve(projectRoot, ".glotfile", "usage.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as UsageCacheFile;
  } catch {
    return null;
  }
}

export function saveUsageCache(projectRoot: string, cache: UsageCacheFile): void {
  ensureGlotfileDir(projectRoot);
  const path = resolve(projectRoot, ".glotfile", "usage.json");
  writeFileAtomic(path, JSON.stringify(cache, null, 2) + "\n");
}

export interface MissingEntry { key: string; locale: string }

export function findMissing(state: State): MissingEntry[] {
  const targets = state.config.locales
    .filter((l) => l !== state.config.sourceLocale)
    .sort();
  const out: MissingEntry[] = [];
  for (const key of Object.keys(state.keys).sort()) {
    const entry = state.keys[key]!;
    if (entry.skipTranslate) continue;
    for (const locale of targets) {
      // A plural target counts as translated once it has a non-blank "other"
      // form; a scalar target once it has a non-blank value.
      const v = entry.plural
        ? entry.values[locale]?.forms?.other?.trim()
        : entry.values[locale]?.value?.trim();
      if (!v) out.push({ key, locale });
    }
  }
  return out;
}

// Keys with at least one code reference in the scan cache: an exact ref match,
// or a dynamic prefix the key falls under (e.g. prefix "errors." covers
// "errors.timeout"). Prefix-only matches count as used — a key referenced
// dynamically must not be reported as dead. Keys matching a config.scan.keep
// glob also count as used: they're consumed by code the scanner can't see
// (framework internals, vendored packages). Restricted to keys in `state` so
// the result is bounded and meaningful.
export function computeUsedKeys(state: State, cache: UsageCacheFile): string[] {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const entry of Object.values(cache.files)) {
    for (const r of entry.refs) exact.add(r.key);
    for (const p of entry.prefixes) {
      // Skip empty prefixes — a fully dynamic key tells us nothing and an empty
      // string would prefix-match every key.
      if (p.prefix) prefixes.push(p.prefix);
    }
  }
  const matchers: Array<(key: string) => boolean> = [];
  const seenLiterals = new Set<string>();
  for (const entry of Object.values(cache.files)) {
    for (const l of entry.literals ?? []) {
      if (!l.literal || seenLiterals.has(l.literal)) continue;
      seenLiterals.add(l.literal);
      matchers.push(literalMatcher(l.literal));
    }
  }
  const keep = (state.config.scan?.keep ?? []).map(globToRegExp);
  return Object.keys(state.keys)
    .filter((key) =>
      exact.has(key) ||
      prefixes.some((p) => key.startsWith(p)) ||
      matchers.some((matches) => matches(key)) ||
      keep.some((re) => re.test(key)))
    .sort();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// How a key-shaped literal counts as usage of a catalog key:
//   - %s/%d stand in for exactly one key segment (sprintf-built keys)
//   - a trailing dot is an explicit prefix (the head of an interpolated string)
//   - otherwise it matches the key itself, or acts as a prefix at a segment
//     boundary (the literal is concatenated with ".suffix" elsewhere)
export function literalMatcher(literal: string): (key: string) => boolean {
  if (/%[sd]/.test(literal)) {
    const re = new RegExp(`^${literal.split(/%[sd]/).map(escapeRe).join("[^.]+")}$`);
    return (key) => re.test(key);
  }
  if (literal.endsWith(".")) return (key) => key.startsWith(literal);
  return (key) => key === literal || key.startsWith(literal + ".");
}
