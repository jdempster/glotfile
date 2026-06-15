import { existsSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { getAdapter, type ExportWarning } from "./adapters/index.js";
import { resolveLocaleToken } from "./adapters/options.js";
import { writeFileAtomic } from "./atomic-write.js";
import type { Config, OutputConfig, State } from "./schema.js";

export interface ExportToDiskResult {
  written: number;
  skipped: number;
  deleted: number;
  warnings: ExportWarning[];
}

// The locales actually written: the optional `exportLocales` allow-list intersected
// with the project locales, or all project locales when no limit is set.
export function effectiveLocales(config: Config): string[] {
  const limit = config.exportLocales;
  if (!limit || limit.length === 0) return config.locales;
  return config.locales.filter((l) => limit.includes(l));
}

// A shallow view of state with `config.locales` narrowed to the export limit. Adapters
// iterate `config.locales`, so this scopes every adapter without touching any of them.
// Source-fallback (`emptyAs: "source"`) is unaffected — adapters read the source value
// from `entry.values[sourceLocale]` directly, not via `config.locales`.
export function narrowForExport(state: State): State {
  const locales = effectiveLocales(state.config);
  if (locales.length === state.config.locales.length) return state;
  return { ...state, config: { ...state.config, locales } };
}

// A path token must look like a locale (2-3 letter base, optional subtags) before
// its file is eligible for pruning — keeps template-shaped neighbours such as
// locales/index.json safe from deletion.
const LOCALE_TOKEN = /^[a-z]{2,3}([_-][a-z0-9]+)*$/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function segmentRegExp(segment: string): RegExp {
  const pattern = escapeRegExp(segment)
    .replaceAll("\\{locale\\}", "(?<locale>[A-Za-z0-9_-]+)")
    .replaceAll("\\{namespace\\}", "[^/]*");
  return new RegExp(`^${pattern}$`);
}

// Best-effort removal of directories left empty by pruning, walking up but never
// past the project root. rmdir on a non-empty directory throws, which stops the walk.
function removeEmptyDirs(dir: string, stopAt: string): void {
  let current = dir;
  while (current !== stopAt && current.startsWith(stopAt + sep)) {
    try {
      rmdirSync(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

// Delete files a previous export wrote for locales that no longer exist: walk the
// output's path template segment by segment, and unlink any match whose {locale}
// token is locale-shaped but absent from `validTokens`. Tokens are derived from the
// full project locale list (not the exportLocales-narrowed one), so limiting an
// export never deletes the other locales' files.
function pruneStaleLocaleFiles(output: OutputConfig, validTokens: Set<string>, projectRoot: string): number {
  const segments = output.path.split("/").filter(Boolean);
  if (!segments.some((s) => s.includes("{locale}"))) return 0;
  const root = resolve(projectRoot);
  let deleted = 0;

  const stale = (token: string | undefined): token is string =>
    token !== undefined && !validTokens.has(token) && LOCALE_TOKEN.test(token);

  const visit = (dir: string, index: number, locale: string | undefined): void => {
    const segment = segments[index]!;
    const isLast = index === segments.length - 1;
    if (!segment.includes("{locale}") && !segment.includes("{namespace}")) {
      const next = resolve(dir, segment);
      if (isLast) {
        if (stale(locale) && existsSync(next) && statSync(next).isFile()) {
          unlinkSync(next);
          deleted++;
          removeEmptyDirs(dir, root);
        }
        return;
      }
      visit(next, index + 1, locale);
      return;
    }
    const re = segmentRegExp(segment);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const m = entry.name.match(re);
      if (!m) continue;
      const token = m.groups?.locale ?? locale;
      if (isLast) {
        if (!entry.isFile() || !stale(token)) continue;
        unlinkSync(resolve(dir, entry.name));
        deleted++;
        removeEmptyDirs(dir, root);
      } else if (entry.isDirectory()) {
        visit(resolve(dir, entry.name), index + 1, token);
      }
    }
  };

  visit(root, 0, undefined);
  return deleted;
}

// The single export writer shared by `glotfile export`, the API, and the serve
// auto-export hook. Files whose on-disk content already equals the generated
// content are left untouched (no mtime churn / spurious HMR reloads), which —
// given deterministic adapters — makes a re-export a no-op.
export function exportToDisk(state: State, projectRoot: string, opts?: { adapter?: string }): ExportToDiskResult {
  const allLocales = state.config.locales;
  state = narrowForExport(state);
  const outputs = opts?.adapter
    ? state.config.outputs.filter((o) => o.adapter === opts.adapter)
    : state.config.outputs;
  const warnings: ExportWarning[] = [];
  let written = 0;
  let skipped = 0;
  let deleted = 0;
  for (const output of outputs) {
    const adapter = getAdapter(output.adapter);
    const result = adapter.export(state, output);
    warnings.push(...result.warnings);
    const writtenPaths = new Set<string>();
    for (const f of result.files) {
      const abs = resolve(projectRoot, f.path);
      // A locale collision (two locales -> one token) emits two files at the
      // same path; the first (config-locale order) wins, the rest are skipped.
      // The adapter has already raised a locale-collision warning.
      if (writtenPaths.has(abs)) { skipped++; continue; }
      writtenPaths.add(abs);
      let current: string | null = null;
      try {
        current = readFileSync(abs, "utf8");
      } catch {
        /* file doesn't exist yet */
      }
      if (current === f.contents) {
        skipped++;
        continue;
      }
      writeFileAtomic(abs, f.contents);
      written++;
    }
    const validTokens = new Set(allLocales.map((l) => resolveLocaleToken(output, l, adapter.defaultLocaleCase)));
    deleted += pruneStaleLocaleFiles(output, validTokens, projectRoot);
  }
  return { written, skipped, deleted, warnings };
}
