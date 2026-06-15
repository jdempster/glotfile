import { detect } from "./detect.js";
import { getParser } from "./parsers/index.js";
import { CACHE_VERSION } from "../scanner.js";
import { saveUsageCache, type UsageCacheFile } from "../scan.js";
import type { ParseResult } from "./types.js";
import type { State } from "../schema.js";

// Formats whose keys never appear literally in code (Angular's trans-unit ids are
// content hashes), so the regex scanner can't find them. For these the catalog
// itself carries source locations — see ParsedKey.locations.
const LOCATION_SCANNED_ADAPTERS = new Set(["angular-xliff"]);

export function isLocationScannedState(state: State): boolean {
  return state.config.outputs.some((o) => LOCATION_SCANNED_ADAPTERS.has(o.adapter));
}

// Turn parser-recovered locations into the usage-cache shape the scanner produces,
// so the UI usage tree and computeUsedKeys work unchanged. mtime/size are 0: these
// entries don't correspond to a single scannable file and are never reused by the
// incremental code scanner.
export function buildLocationUsageCache(parsed: ParseResult): UsageCacheFile {
  const files: UsageCacheFile["files"] = {};
  for (const [key, pk] of Object.entries(parsed.keys)) {
    for (const loc of pk.locations ?? []) {
      const file = (files[loc.file] ??= { mtime: 0, size: 0, refs: [], prefixes: [] });
      file.refs.push({ key, line: loc.line, col: 1, scanner: "angular-xliff" });
    }
  }
  return { version: CACHE_VERSION, scannedAt: new Date().toISOString(), files };
}

// File and reference totals for a usage cache (for scan/sync console + API output).
export function usageCounts(cache: UsageCacheFile): { files: number; refs: number } {
  return {
    files: Object.keys(cache.files).length,
    refs: Object.values(cache.files).reduce((n, f) => n + f.refs.length, 0),
  };
}

// Re-derive .glotfile/usage.json from the catalog's source locations. Used by
// `sync`/`import` and by `scan` for location-scanned formats, in place of the
// regex code walk. Returns the saved cache (null if nothing was detected).
export function refreshLocationUsage(projectRoot: string, format?: string): UsageCacheFile | null {
  const det = detect(projectRoot, format);
  if (!det) return null;
  const parsed = getParser(det.format).parse(det.localeRoot, { locales: [det.sourceLocale] });
  const cache = buildLocationUsageCache(parsed);
  saveUsageCache(projectRoot, cache);
  return cache;
}
