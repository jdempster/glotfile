import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, relative } from "node:path";
import type { UsageCacheFile } from "./scan.js";
import { saveUsageCache } from "./scan.js";

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PATTERNS: Record<string, RegExp[]> = {
  laravel: [
    /\b(?:__|trans|trans_choice|Lang::(?:get|choice))\s*\(\s*'([^']+)'/g,
    /\b(?:__|trans|trans_choice|Lang::(?:get|choice))\s*\(\s*"([^"]+)"/g,
    /@(?:lang|choice)\s*\(\s*'([^']+)'/g,
    /@(?:lang|choice)\s*\(\s*"([^"]+)"/g,
  ],
  "js-i18n": [
    /\$t\s*\(\s*'([^']+)'/g,
    /\$t\s*\(\s*"([^"]+)"/g,
    /\$t\s*\(\s*`([^`$\n]+)`/g,
    /\bi18n\.t\s*\(\s*'([^']+)'/g,
    /\bi18n\.t\s*\(\s*"([^"]+)"/g,
    /\bi18next\.t\s*\(\s*'([^']+)'/g,
    /\bi18next\.t\s*\(\s*"([^"]+)"/g,
    // t('key') — word boundary before t, not preceded by dot (excludes i18n.t which is above)
    /(?<!\.)(?<![a-zA-Z0-9_$])\bt\s*\(\s*'([^']+)'/g,
    /(?<!\.)(?<![a-zA-Z0-9_$])\bt\s*\(\s*"([^"]+)"/g,
    /(?<!\.)(?<![a-zA-Z0-9_$])\bt\s*\(\s*`([^`$\n]+)`/g,
    // vue-i18n pluralization: $tc('key') and the destructured bare tc('key').
    /\$tc\s*\(\s*'([^']+)'/g,
    /\$tc\s*\(\s*"([^"]+)"/g,
    /(?<!\.)(?<![a-zA-Z0-9_$])\btc\s*\(\s*'([^']+)'/g,
    /(?<!\.)(?<![a-zA-Z0-9_$])\btc\s*\(\s*"([^"]+)"/g,
    // React-i18next <Trans i18nKey="key" /> (attribute order tolerated).
    /<Trans\b[^>]*\bi18nKey\s*=\s*'([^']+)'/g,
    /<Trans\b[^>]*\bi18nKey\s*=\s*"([^"]+)"/g,
    // A renamed translate() wrapper (covers the common `const { t: translate }`
    // alias by name; arbitrary aliases aren't resolved). Method `.translate()`
    // is excluded. Over-matching here only keeps keys "used" — the safe direction
    // for prune, which deletes only keys with no match at all.
    /(?<!\.)(?<![a-zA-Z0-9_$])\btranslate\s*\(\s*'([^']+)'/g,
    /(?<!\.)(?<![a-zA-Z0-9_$])\btranslate\s*\(\s*"([^"]+)"/g,
  ],
  gettext: [
    /\b(?:gettext|ngettext)\s*\(\s*'([^']+)'/g,
    /\b(?:gettext|ngettext)\s*\(\s*"([^"]+)"/g,
    // _() — word boundary, not preceded by alphanumeric
    /(?<![a-zA-Z0-9_$])_\s*\(\s*'([^']+)'/g,
    /(?<![a-zA-Z0-9_$])_\s*\(\s*"([^"]+)"/g,
  ],
  apple: [
    /NSLocalizedString\s*\(\s*@?"([^"]+)"/g,
    /String\s*\(\s*localized:\s*"([^"]+)"/g,
    /localizedString\s*\(\s*forKey:\s*"([^"]+)"/g,
    // The "key".localized / "key".localised String-extension idiom, where the
    // literal IS the key (common when keys are natural-language source text).
    /"([^"]+)"\s*\.\s*localized\b/g,
    /"([^"]+)"\s*\.\s*localised\b/g,
  ],
};

// Dynamically-built keys: a statically-known leading literal followed by
// concatenation (PHP `.`, JS `+`) or interpolation (`{$x}` / `$x` / `${x}`).
// The capture group is the prefix; any key that starts with it is a match.
const PREFIX_PATTERNS: Record<string, RegExp[]> = {
  laravel: [
    /\b(?:__|trans|trans_choice|Lang::(?:get|choice))\s*\(\s*'([^']*)'\s*\./g,
    /\b(?:__|trans|trans_choice|Lang::(?:get|choice))\s*\(\s*"([^"]*)"\s*\./g,
    /\b(?:__|trans|trans_choice|Lang::(?:get|choice))\s*\(\s*"([^"${]*)\{?\$/g,
  ],
  "js-i18n": [
    /(?:\$t|i18n\.t|i18next\.t)\s*\(\s*'([^']*)'\s*\+/g,
    /(?:\$t|i18n\.t|i18next\.t)\s*\(\s*"([^"]*)"\s*\+/g,
    /(?<!\.)(?<![a-zA-Z0-9_$])\bt\s*\(\s*'([^']*)'\s*\+/g,
    /(?<!\.)(?<![a-zA-Z0-9_$])\bt\s*\(\s*"([^"]*)"\s*\+/g,
    /(?:\$t|i18n\.t|i18next\.t)\s*\(\s*`([^`$]*)\$\{/g,
    /(?<!\.)(?<![a-zA-Z0-9_$])\bt\s*\(\s*`([^`$]*)\$\{/g,
  ],
};

// Version of the extraction logic. Bump this whenever PATTERNS, PREFIX_PATTERNS,
// extractLiterals, or how refs/prefixes are produced changes — runScan discards
// any cache written by a different version, so unchanged files get re-scanned
// with the new logic instead of silently keeping stale (mtime+size-matched) results.
export const CACHE_VERSION = 8;

const EXT_SCANNER: Record<string, string> = {
  ".php": "laravel",
  ".vue": "js-i18n",
  ".js": "js-i18n",
  ".ts": "js-i18n",
  ".jsx": "js-i18n",
  ".tsx": "js-i18n",
  ".mjs": "js-i18n",
  ".cjs": "js-i18n",
  ".dart": "flutter",
  ".py": "gettext",
  ".c": "gettext",
  ".cpp": "gettext",
  ".h": "gettext",
  ".swift": "apple",
  ".m": "apple",
  ".mm": "apple",
};

// Directories always excluded regardless of user config
const ALWAYS_EXCLUDE = new Set([
  "node_modules", ".git", ".glotfile", ".claude", "dist", "build",
  "vendor", "coverage", ".next", ".nuxt", ".turbo", "__pycache__",
]);

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export interface ScanOptions {
  include?: string[];
  exclude?: string[];
  // Extra Flutter gen_l10n accessor names — the variable `AppLocalizations.of(...)`
  // is assigned to. Auto-detection already covers most projects; this is an escape
  // hatch for ones it can't infer.
  accessors?: string[];
  // Custom regexes applied (in addition to the built-ins) to every scanned file.
  // Capture group 1 is the key.
  patterns?: string[];
}

export function scannerForExt(ext: string): string | null {
  return EXT_SCANNER[ext] ?? null;
}

// Conventional names the Flutter gen_l10n accessor is bound to. detectFlutterAccessors
// finds whatever a project actually uses; these are the always-on fallback.
const FLUTTER_ACCESSOR_DEFAULTS = ["l10n", "loc", "localizations", "translations"];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Identifiers bound to AppLocalizations: assigned from `AppLocalizations.of(...)`
// or declared with an `AppLocalizations` type (parameter, field, typed local).
// The trailing `\b(?!\s*\()` keeps method declarations like the generated
// `static AppLocalizations of(...)` from being mistaken for an accessor.
function detectFlutterAccessors(content: string): string[] {
  const names = new Set<string>();
  const assigned = /\b([a-zA-Z_]\w*)\s*=\s*AppLocalizations\s*\.\s*of\s*\(/g;
  const typed = /\bAppLocalizations[?!]?\s+([a-zA-Z_]\w*)\b(?!\s*\()/g;
  let m: RegExpExecArray | null;
  while ((m = assigned.exec(content)) !== null) names.add(m[1]!);
  while ((m = typed.exec(content)) !== null) names.add(m[1]!);
  return [...names];
}

function flutterPatterns(content: string, opts?: ScanOptions): RegExp[] {
  const names = [...new Set([
    ...FLUTTER_ACCESSOR_DEFAULTS,
    ...detectFlutterAccessors(content),
    ...(opts?.accessors ?? []),
  ])].map(escapeRe);
  return [
    // AppLocalizations.of(context)!.key — tolerates the !/? null-assertion.
    /AppLocalizations\.of\([^)]*\)[!?]?\.([a-zA-Z_][a-zA-Z0-9_]*)/g,
    // <accessor>.key — accessor is conventional, auto-detected, or configured.
    new RegExp(`\\b(?:${names.join("|")})[!?]?\\s*\\.([a-zA-Z_][a-zA-Z0-9_]*)`, "g"),
  ];
}

function customPatterns(opts?: ScanOptions): RegExp[] {
  const out: RegExp[] = [];
  for (const p of opts?.patterns ?? []) {
    // Patterns are validated at config-load time; this guard means a stray one
    // can never abort a scan.
    try { out.push(new RegExp(p, "g")); } catch { /* skip invalid */ }
  }
  return out;
}

// ---------------------------------------------------------------------------
// next-intl — namespace-aware extraction
// ---------------------------------------------------------------------------

// next-intl keys are namespace-relative: `useTranslations('index')` then
// `t('heading')` references `index.heading`. The stateless js-i18n regexes would
// capture only `heading`, so a file importing next-intl gets this binding-aware
// pass instead.
const NEXT_INTL_IMPORT = /(?:from\s*|require\(\s*)['"]next-intl(?:\/[\w-]+)?['"]/;

export function isNextIntlFile(content: string): boolean {
  return NEXT_INTL_IMPORT.test(content);
}

interface NiBinding { name: string; ns: string; index: number }

// `const t = useTranslations('ns')`, `useTranslations()`, or `await getTranslations('ns')`.
const NI_BIND = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*(?:['"]([^'"]*)['"])?\s*\)/g;
// `const t = await getTranslations({ … namespace: 'ns' … })`.
const NI_BIND_OBJ = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?getTranslations\s*\(\s*\{[^}]*?\bnamespace\s*:\s*['"]([^'"]+)['"][^}]*?\}\s*\)/g;
// The `.rich`/`.markup`/`.raw`/`.has` call variants on a bound translator.
const NI_METHOD = "(?:\\.(?:rich|markup|raw|has))?";

function nextIntlBindings(content: string): NiBinding[] {
  const out: NiBinding[] = [];
  for (const m of content.matchAll(NI_BIND)) out.push({ name: m[1]!, ns: m[2] ?? "", index: m.index! });
  for (const m of content.matchAll(NI_BIND_OBJ)) out.push({ name: m[1]!, ns: m[2]!, index: m.index! });
  return out;
}

// The namespace in effect for `name` at `index`: the nearest binding of that
// variable occurring before the call, so a file with several components each
// rebinding `t` to a different namespace resolves each call correctly.
function nsForBindingAt(bindings: NiBinding[], name: string, index: number): string | null {
  let best: NiBinding | null = null;
  for (const b of bindings) {
    if (b.name === name && b.index < index && (!best || b.index > best.index)) best = b;
  }
  return best ? best.ns : null;
}

function joinKey(ns: string, rel: string): string {
  return ns ? `${ns}.${rel}` : rel;
}

function uniqueBindingNames(bindings: NiBinding[]): string[] {
  return [...new Set(bindings.map((b) => b.name))];
}

// Static `t('key')` / `t.rich('key')` … calls, resolved to full namespaced keys.
// Dynamic template/concatenation keys are left to nextIntlPrefixMatches.
function nextIntlRefMatches(content: string): Array<{ key: string; index: number }> {
  const bindings = nextIntlBindings(content);
  const out: Array<{ key: string; index: number }> = [];
  for (const name of uniqueBindingNames(bindings)) {
    const re = new RegExp(
      `\\b${escapeRe(name)}${NI_METHOD}\\s*\\(\\s*(?:'([^'\\n]+)'|"([^"\\n]+)"|\`([^\`$\\n]+)\`)`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const ns = nsForBindingAt(bindings, name, m.index);
      if (ns === null) continue;
      out.push({ key: joinKey(ns, m[1] ?? m[2] ?? m[3]!), index: m.index });
    }
  }
  return out;
}

// Dynamic next-intl keys → prefixes: a concatenated/interpolated head becomes
// `<ns>.<head>`, and a fully dynamic argument covers the whole `<ns>.` namespace.
function nextIntlPrefixMatches(content: string): Array<{ prefix: string; index: number }> {
  const bindings = nextIntlBindings(content);
  const out: Array<{ prefix: string; index: number }> = [];
  for (const name of uniqueBindingNames(bindings)) {
    const ev = escapeRe(name);
    const headConcat = new RegExp(`\\b${ev}${NI_METHOD}\\s*\\(\\s*(?:'([^'\\n]*)'|"([^"\\n]*)")\\s*\\+`, "g");
    const headTemplate = new RegExp(`\\b${ev}${NI_METHOD}\\s*\\(\\s*\`([^\`$\\n]*)\\$\\{`, "g");
    const dynamicArg = new RegExp(`\\b${ev}${NI_METHOD}\\s*\\(\\s*[A-Za-z_$][\\w$.]*\\s*[),]`, "g");
    let m: RegExpExecArray | null;
    for (const re of [headConcat, headTemplate]) {
      while ((m = re.exec(content)) !== null) {
        const ns = nsForBindingAt(bindings, name, m.index);
        if (ns === null) continue;
        out.push({ prefix: joinKey(ns, m[1] ?? m[2] ?? ""), index: m.index });
      }
    }
    while ((m = dynamicArg.exec(content)) !== null) {
      const ns = nsForBindingAt(bindings, name, m.index);
      if (!ns) continue;
      out.push({ prefix: `${ns}.`, index: m.index });
    }
  }
  return out;
}

// Offsets at which each line begins; lineStarts[i] is the start of line i+1.
function lineStartOffsets(content: string): number[] {
  const starts = [0];
  let idx = content.indexOf("\n");
  while (idx !== -1) {
    starts.push(idx + 1);
    idx = content.indexOf("\n", idx + 1);
  }
  return starts;
}

// Map a 0-based offset to a 1-based { line, col } via binary search over line starts.
function offsetToLineCol(starts: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - starts[lo]! + 1 };
}

export function extractRefs(
  content: string,
  scanner: string,
  opts?: ScanOptions,
): Array<{ key: string; line: number; col: number; scanner: string }> {
  // A js-i18n-eligible file that imports next-intl needs binding-aware extraction;
  // an explicit "next-intl" scanner forces it (used by unit tests).
  const useNextIntl = scanner === "next-intl" || (scanner === "js-i18n" && isNextIntlFile(content));
  const effScanner = useNextIntl ? "next-intl" : scanner;

  // Match against the whole file rather than line-by-line: the `\s*` between the
  // call and its key already spans newlines, so a multi-line call like
  // `$t(\n  'key',\n  { … })` is found. Position is the function-call start.
  const starts = lineStartOffsets(content);
  const result: Array<{ key: string; line: number; col: number; scanner: string }> = [];
  const seen = new Set<string>();
  const push = (key: string, index: number) => {
    const { line, col } = offsetToLineCol(starts, index);
    const dedup = `${line}:${col}:${key}`;
    if (!seen.has(dedup)) {
      seen.add(dedup);
      result.push({ key, line, col, scanner: effScanner });
    }
  };

  if (useNextIntl) {
    for (const r of nextIntlRefMatches(content)) push(r.key, r.index);
  } else {
    const base = scanner === "flutter" ? flutterPatterns(content, opts) : (PATTERNS[scanner] ?? []);
    for (const pattern of base) eachMatch(content, pattern, push);
  }
  // Custom patterns apply on top of either path.
  for (const pattern of customPatterns(opts)) eachMatch(content, pattern, push);

  result.sort((a, b) => a.line - b.line || a.col - b.col);
  return result;
}

// Run a (global) pattern over the whole file, calling `fn(captureGroup1, index)`
// for each match. The lastIndex guard avoids an infinite loop on a zero-width match.
function eachMatch(content: string, pattern: RegExp, fn: (key: string, index: number) => void): void {
  const re = new RegExp(pattern.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++;
    fn(m[1]!, m.index);
  }
}

export function extractPrefixes(
  content: string,
  scanner: string,
): Array<{ prefix: string; line: number; col: number; scanner: string }> {
  const useNextIntl = scanner === "next-intl" || (scanner === "js-i18n" && isNextIntlFile(content));
  const effScanner = useNextIntl ? "next-intl" : scanner;

  const starts = lineStartOffsets(content);
  const result: Array<{ prefix: string; line: number; col: number; scanner: string }> = [];
  const seen = new Set<string>();
  const push = (prefix: string, index: number) => {
    // Skip empty prefixes — a fully dynamic key (e.g. $t('' + x)) tells us nothing.
    if (!prefix) return;
    const { line, col } = offsetToLineCol(starts, index);
    const dedup = `${line}:${col}:${prefix}`;
    if (!seen.has(dedup)) {
      seen.add(dedup);
      result.push({ prefix, line, col, scanner: effScanner });
    }
  };

  if (useNextIntl) {
    for (const p of nextIntlPrefixMatches(content)) push(p.prefix, p.index);
  } else {
    for (const pattern of PREFIX_PATTERNS[scanner] ?? []) eachMatch(content, pattern, push);
  }

  result.sort((a, b) => a.line - b.line || a.col - b.col);
  return result;
}

// ---------------------------------------------------------------------------
// extractLiterals — key-shaped string literals anywhere in the file
// ---------------------------------------------------------------------------

// Keys are often built away from the trans() call: assigned in a ternary, stored
// in an array, or interpolated into a variable that's translated later. The call
// patterns above can't see those, but the key text is still a string literal in
// the file — so capture every key-shaped literal as lower-confidence evidence.
// computeUsedKeys matches them against the catalog (exact, prefix, %s wildcard),
// which bounds the noise: a false "used" requires the exact key text to appear.

// At least two dot-separated segments; the first may carry a namespace path
// (slashes/hyphens), %s/%d may stand in for a whole segment (sprintf-built keys),
// and a trailing dot marks an explicit prefix (the head of an interpolated string).
const KEY_SHAPE = /^[A-Za-z0-9_][A-Za-z0-9_/-]*(?:\.(?:[A-Za-z0-9_-]+|%[sd]))+\.?$/;

// One pattern per quote style; strings with escapes or newlines are skipped —
// a translation key never needs either.
const STRING_LITERALS = [
  /'([^'\\\n]+)'/g,
  /"([^"\\\n]+)"/g,
  /`([^`\\\n]+)`/g,
];

export function extractLiterals(content: string): Array<{ literal: string; line: number; col: number }> {
  const starts = lineStartOffsets(content);
  const result: Array<{ literal: string; line: number; col: number }> = [];
  const seen = new Set<string>();

  for (const pattern of STRING_LITERALS) {
    const re = new RegExp(pattern.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      let text = m[1]!;
      // Interpolated string: keep the literal head as a prefix, but only when it
      // ends at a segment boundary — "emails/foo.{$x}" tells us the prefix,
      // "emails/foo{$x}" tells us nothing reliable.
      const marker = text.search(/\{\$|\$\{/);
      if (marker !== -1) {
        text = text.slice(0, marker);
        if (!text.endsWith(".")) continue;
      }
      if (!KEY_SHAPE.test(text)) continue;
      const { line, col } = offsetToLineCol(starts, m.index);
      const dedup = `${line}:${col}:${text}`;
      if (!seen.has(dedup)) {
        seen.add(dedup);
        result.push({ literal: text, line, col });
      }
    }
  }

  result.sort((a, b) => a.line - b.line || a.col - b.col);
  return result;
}

// ---------------------------------------------------------------------------
// runScan
// ---------------------------------------------------------------------------

function matchesGlob(relPath: string, glob: string): boolean {
  // Convert glob to regex: ** = any path segment(s), * = single segment chars
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^/]*")
    .replace(/ /g, ".*");
  return new RegExp(`^${escaped}$`).test(relPath);
}

function isExcluded(relPath: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((p) => matchesGlob(relPath, p));
}

function isIncluded(relPath: string, includePatterns: string[]): boolean {
  if (includePatterns.length === 0) return true;
  return includePatterns.some((p) => matchesGlob(relPath, p));
}

function* walkFiles(dir: string, root: string, exclude: string[]): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    // Skip always-excluded directory names at any depth (node_modules, .git, etc.)
    if (ALWAYS_EXCLUDE.has(name)) continue;
    const abs = join(dir, name);
    const rel = relative(root, abs);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) {
      yield* walkFiles(abs, root, exclude);
    } else if (st.isFile()) {
      yield rel;
    }
  }
}

export function runScan(
  projectRoot: string,
  opts: ScanOptions,
  existing?: UsageCacheFile | null,
): UsageCacheFile {
  const exclude = opts.exclude ?? [];
  const include = opts.include ?? [];

  const cache: UsageCacheFile = {
    version: CACHE_VERSION,
    scannedAt: new Date().toISOString(),
    files: {},
  };

  // Only reuse a cache produced by the current extraction logic. A version
  // mismatch means the patterns changed, so every file must be re-scanned.
  const reusable = existing && existing.version === CACHE_VERSION ? existing : null;

  for (const relPath of walkFiles(projectRoot, projectRoot, exclude)) {
    if (isExcluded(relPath, exclude)) continue;
    if (!isIncluded(relPath, include)) continue;

    const ext = extname(relPath);
    const scanner = scannerForExt(ext);
    if (!scanner) continue;

    const abs = join(projectRoot, relPath);
    let st;
    try { st = statSync(abs); } catch { continue; }

    const mtime = Math.floor(st.mtimeMs);
    const size = st.size;

    // Reuse cached entry if the file hasn't changed
    const prev = reusable?.files[relPath];
    if (prev && prev.mtime === mtime && prev.size === size) {
      cache.files[relPath] = prev;
      continue;
    }

    let content: string;
    try { content = readFileSync(abs, "utf8"); } catch { continue; }

    cache.files[relPath] = {
      mtime,
      size,
      refs: extractRefs(content, scanner, opts),
      prefixes: extractPrefixes(content, scanner),
      literals: extractLiterals(content),
    };
  }

  saveUsageCache(projectRoot, cache);
  return cache;
}
