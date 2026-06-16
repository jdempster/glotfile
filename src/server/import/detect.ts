import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Detection {
  format: string;
  localeRoot: string;
  locales: string[];
  sourceLocale: string;
}

const LOCALE_RE = /^[a-z]{2,3}([_-][A-Za-z]{2,4}){0,2}$/;
const VUE_DIR_CANDIDATES = ["src/locale", "src/locales", "src/i18n/locales", "locales", "lang"];

function safeIsDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function listDirs(dir: string): string[] {
  return readdirSync(dir).filter((e) => safeIsDir(join(dir, e)));
}

function fileCount(dir: string): number {
  try { return readdirSync(dir).length; } catch { return 0; }
}

function pickSource(locales: string[], sizeOf: (loc: string) => number): string {
  if (locales.includes("en")) return "en";
  return [...locales].sort((a, b) => sizeOf(b) - sizeOf(a) || a.localeCompare(b))[0] ?? "en";
}

function detectLaravel(root: string): Detection | null {
  const localeRoot = [join(root, "resources", "lang"), join(root, "lang")].find(safeIsDir);
  if (!localeRoot) return null;
  const locales = listDirs(localeRoot).filter((d) => LOCALE_RE.test(d));
  if (locales.length === 0) return null;
  const sourceLocale = pickSource(locales, (loc) => fileCount(join(localeRoot, loc)));
  return { format: "laravel-php", localeRoot, locales, sourceLocale };
}

function detectVue(root: string, forced = false): Detection | null {
  for (const rel of VUE_DIR_CANDIDATES) {
    const localeRoot = join(root, rel);
    if (!safeIsDir(localeRoot)) continue;
    const locales = readdirSync(localeRoot)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter((l) => LOCALE_RE.test(l));
    // A lone JSON file could be anything (e.g. lang/app.json), so auto-detect
    // only trusts a single locale when it's "en"; a forced format trusts any.
    const enough = locales.length >= 2
      || (locales.length === 1 && (forced || locales[0] === "en" || locales[0].startsWith("en-") || locales[0].startsWith("en_")));
    if (enough) {
      const sourceLocale = pickSource(locales, (loc) => {
        try { return statSync(join(localeRoot, `${loc}.json`)).size; } catch { return 0; }
      });
      return { format: "vue-i18n-json", localeRoot, locales, sourceLocale };
    }
  }
  return null;
}

// next-intl shares the nested-JSON-per-locale shape with vue-i18n, so detection
// is gated on a project signal — a next-intl dependency or its i18n/request entry
// — to keep plain Vue projects out. Runs before detectVue for the same reason.
const NEXT_INTL_CONFIG_CANDIDATES = ["src/i18n/request.ts", "i18n/request.ts", "src/i18n/request.js", "i18n/request.js"];
const NEXT_INTL_ROUTING_CANDIDATES = ["src/i18n/routing.ts", "i18n/routing.ts", "src/i18n/routing.js", "i18n/routing.js"];
const NEXT_INTL_DIR_CANDIDATES = ["messages", "src/messages", "locales", "src/locales", "src/i18n/messages"];

function hasNextIntlSignal(root: string): boolean {
  if (NEXT_INTL_CONFIG_CANDIDATES.some((rel) => existsSync(join(root, rel)))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (pkg.dependencies?.["next-intl"] || pkg.devDependencies?.["next-intl"]) return true;
  } catch { /* no/unreadable package.json */ }
  return false;
}

// next-intl's routing config names the authoritative source locale (defaultLocale),
// which a filename heuristic can't recover when several en-* variants coexist.
function nextIntlDefaultLocale(root: string): string | undefined {
  for (const rel of NEXT_INTL_ROUTING_CANDIDATES) {
    try {
      const m = readFileSync(join(root, rel), "utf8").match(/defaultLocale\s*:\s*['"]([^'"]+)['"]/);
      if (m) return m[1];
    } catch { /* try the next candidate */ }
  }
  return undefined;
}

function detectNextIntl(root: string, forced = false): Detection | null {
  if (!forced && !hasNextIntlSignal(root)) return null;
  for (const rel of NEXT_INTL_DIR_CANDIDATES) {
    const localeRoot = join(root, rel);
    if (!safeIsDir(localeRoot)) continue;
    const locales = readdirSync(localeRoot)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter((l) => LOCALE_RE.test(l));
    if (locales.length === 0) continue;
    const def = nextIntlDefaultLocale(root);
    const sourceLocale = def && locales.includes(def)
      ? def
      : pickSource(locales, (loc) => {
          try { return statSync(join(localeRoot, `${loc}.json`)).size; } catch { return 0; }
        });
    return { format: "next-intl-json", localeRoot, locales, sourceLocale };
  }
  return null;
}

function detectArb(root: string): Detection | null {
  for (const rel of ["lib/l10n", "l10n", "lib/src/l10n"]) {
    const localeRoot = join(root, rel);
    if (!safeIsDir(localeRoot)) continue;
    const locales = readdirSync(localeRoot)
      .map((f) => f.match(/^(?:app_)?(.+)\.arb$/)?.[1])
      .filter((l): l is string => !!l && LOCALE_RE.test(l));
    if (locales.length >= 1) {
      return { format: "flutter-arb", localeRoot, locales, sourceLocale: pickSource(locales, () => 0) };
    }
  }
  return null;
}

// Locales for one candidate dir = its <locale>.lproj subdirs that hold a
// Localizable.strings table.
function lprojLocales(dir: string): string[] {
  return listDirs(dir)
    .map((d) => d.match(/^(.+)\.lproj$/)?.[1])
    .filter((l): l is string => !!l && LOCALE_RE.test(l) && existsSync(join(dir, `${l}.lproj`, "Localizable.strings")));
}

function detectApple(root: string): Detection | null {
  // .lproj dirs commonly sit one level down (e.g. "<App Name>/en.lproj"), so scan
  // the root and each immediate subdir, then pick the dir covering the most locales.
  const candidates = [root, ...listDirs(root).map((d) => join(root, d))];
  let best: Detection | null = null;
  for (const dir of candidates) {
    const locales = lprojLocales(dir);
    if (locales.length === 0) continue;
    if (!best || locales.length > best.locales.length) {
      best = {
        format: "apple-strings",
        localeRoot: dir,
        locales,
        sourceLocale: pickSource(locales, (loc) => {
          try { return statSync(join(dir, `${loc}.lproj`, "Localizable.strings")).size; } catch { return 0; }
        }),
      };
    }
  }
  return best;
}

// Angular's extract-i18n output: messages.xlf (source) plus messages.<locale>.xlf
// translation files, in the configured output dir (src/locale by convention) or
// the project root (the ng default). The source locale comes from the
// source-language attribute, not a filename.
const ANGULAR_DIR_CANDIDATES = [".", "src/locale", "src/locales", "src/i18n", "locale", "locales", "i18n", "translations"];

function detectAngularXliff(root: string): Detection | null {
  for (const rel of ANGULAR_DIR_CANDIDATES) {
    const localeRoot = rel === "." ? root : join(root, rel);
    if (!safeIsDir(localeRoot)) continue;
    const files = readdirSync(localeRoot).filter((f) => /^messages(\..+)?\.xlf$/.test(f)).sort();
    if (files.length === 0) continue;
    const locales = files
      .map((f) => f.match(/^messages\.(.+)\.xlf$/)?.[1])
      .filter((l): l is string => !!l && LOCALE_RE.test(l));
    const attrFile = files.includes("messages.xlf") ? "messages.xlf" : files[0]!;
    let sourceLocale: string | undefined;
    try {
      sourceLocale = readFileSync(join(localeRoot, attrFile), "utf8").match(/source-language="([^"]+)"/)?.[1];
    } catch { /* unreadable file: fall through to the filename-derived locales */ }
    if (!sourceLocale && locales.length === 0) continue;
    sourceLocale ??= pickSource(locales, () => 0);
    if (!locales.includes(sourceLocale)) locales.unshift(sourceLocale);
    return { format: "angular-xliff", localeRoot, locales, sourceLocale };
  }
  return null;
}

// config/locales/ is the Rails convention; the top-level map key in each yml file
// (not the filename — devise.en.yml-style names exist) is the authoritative locale.
function detectRails(root: string): Detection | null {
  const localeRoot = join(root, "config", "locales");
  if (!safeIsDir(localeRoot)) return null;
  const locales: string[] = [];
  for (const file of readdirSync(localeRoot).sort()) {
    if (!/\.ya?ml$/.test(file)) continue;
    let text: string;
    try { text = readFileSync(join(localeRoot, file), "utf8"); } catch { continue; }
    // One file may hold several top-level locales (en: + fr:).
    for (const m of text.matchAll(/^(["']?)([A-Za-z][\w-]*)\1:\s*(?:#.*)?$/gm)) {
      const token = m[2]!;
      if (LOCALE_RE.test(token) && !locales.includes(token)) locales.push(token);
    }
  }
  if (locales.length === 0) return null;
  return { format: "rails-yaml", localeRoot, locales, sourceLocale: pickSource(locales, () => 0) };
}

// i18next's per-locale-directory layout (public/locales/<lng>/<ns>.json). Flat
// <lng>.json files are left to the vue-i18n detector / an explicit --format:
// the dir shape is the only signal that distinguishes the two formats.
const I18NEXT_DIR_CANDIDATES = ["public/locales", "static/locales", "locales", "src/locales", "src/i18n/locales"];

function detectI18next(root: string): Detection | null {
  for (const rel of I18NEXT_DIR_CANDIDATES) {
    const localeRoot = join(root, rel);
    if (!safeIsDir(localeRoot)) continue;
    const locales = listDirs(localeRoot).filter(
      (d) => LOCALE_RE.test(d) && readdirSync(join(localeRoot, d)).some((f) => f.endsWith(".json")),
    );
    if (locales.length === 0) continue;
    const sourceLocale = pickSource(locales, (loc) => {
      try {
        return readdirSync(join(localeRoot, loc))
          .filter((f) => f.endsWith(".json"))
          .reduce((sum, f) => sum + statSync(join(localeRoot, loc, f)).size, 0);
      } catch { return 0; }
    });
    return { format: "i18next-json", localeRoot, locales, sourceLocale };
  }
  return null;
}

// Locales found in one gettext candidate dir: flat <locale>.po files plus
// <locale>/LC_MESSAGES/*.po (or <locale>/*.po) trees.
function gettextLocales(dir: string): string[] {
  const locales: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const flat = entry.match(/^(.+)\.po$/)?.[1];
    if (flat && LOCALE_RE.test(flat)) {
      if (!locales.includes(flat)) locales.push(flat);
      continue;
    }
    if (!LOCALE_RE.test(entry) || !safeIsDir(join(dir, entry))) continue;
    const sub = join(dir, entry);
    const hasPo = (d: string) => { try { return readdirSync(d).some((f) => f.endsWith(".po")); } catch { return false; } };
    if (hasPo(join(sub, "LC_MESSAGES")) || hasPo(sub)) {
      if (!locales.includes(entry)) locales.push(entry);
    }
  }
  return locales;
}

const GETTEXT_DIR_CANDIDATES = ["locale", "locales", "po", "translations"];

function detectGettext(root: string): Detection | null {
  for (const rel of GETTEXT_DIR_CANDIDATES) {
    const localeRoot = join(root, rel);
    if (!safeIsDir(localeRoot)) continue;
    const locales = gettextLocales(localeRoot);
    if (locales.length === 0) continue;
    return { format: "gettext-po", localeRoot, locales, sourceLocale: pickSource(locales, () => 0) };
  }
  return null;
}

// Same .lproj walk as apple-strings but keyed on the .stringsdict table. Runs
// AFTER detectApple in DETECTORS, so a project holding both tables auto-detects
// as apple-strings; stringsdict-only projects (or --format apple-stringsdict)
// land here.
function detectAppleStringsdict(root: string): Detection | null {
  const candidates = [root, ...listDirs(root).map((d) => join(root, d))];
  let best: Detection | null = null;
  for (const dir of candidates) {
    const locales = listDirs(dir)
      .map((d) => d.match(/^(.+)\.lproj$/)?.[1])
      .filter((l): l is string => !!l && LOCALE_RE.test(l) && existsSync(join(dir, `${l}.lproj`, "Localizable.stringsdict")));
    if (locales.length === 0) continue;
    if (!best || locales.length > best.locales.length) {
      best = { format: "apple-stringsdict", localeRoot: dir, locales, sourceLocale: pickSource(locales, () => 0) };
    }
  }
  return best;
}

const DETECTORS = [
  detectLaravel,
  detectNextIntl,
  detectVue,
  detectArb,
  detectApple,
  detectAngularXliff,
  detectRails,
  detectI18next,
  detectGettext,
  detectAppleStringsdict,
];
const BY_FORMAT: Record<string, (root: string) => Detection | null> = {
  "laravel-php": detectLaravel,
  "next-intl-json": (root) => detectNextIntl(root, true),
  "vue-i18n-json": (root) => detectVue(root, true),
  "flutter-arb": detectArb,
  "apple-strings": detectApple,
  "angular-xliff": detectAngularXliff,
  "rails-yaml": detectRails,
  "i18next-json": detectI18next,
  "gettext-po": detectGettext,
  "apple-stringsdict": detectAppleStringsdict,
};

export function detect(root: string, formatOverride?: string): Detection | null {
  if (!existsSync(root)) return null;
  if (formatOverride) {
    const fn = BY_FORMAT[formatOverride];
    if (!fn) throw new Error(`Unknown format: ${formatOverride}`);
    return fn(root);
  }
  for (const fn of DETECTORS) {
    const d = fn(root);
    if (d) return d;
  }
  return null;
}
