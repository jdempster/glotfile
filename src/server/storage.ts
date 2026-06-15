import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { State, KeyEntry, LocaleValue } from "./schema.js";
import { serializeJson } from "./format.js";
import { writeFileAtomic } from "./atomic-write.js";

// The split catalog lives in a directory derived from the single-file path by
// dropping the trailing ".json": glotfile.json -> glotfile, foo.glotfile.json -> foo.glotfile.
export function splitDirFor(statePath: string): string {
  return statePath.replace(/\.json$/i, "");
}

export type StorageFormat = "single" | "split" | "none";

// Split wins over single (a stale single file is removed on the next split-mode save).
export function detectFormat(statePath: string): StorageFormat {
  if (existsSync(join(splitDirFor(statePath), "config.json"))) return "split";
  if (existsSync(statePath)) return "single";
  return "none";
}

// Per-key metadata stored in keys.json: everything on KeyEntry except `values`.
export type KeyMeta = Omit<KeyEntry, "values">;

export interface SplitParts {
  manifest: Record<string, unknown>;                       // State minus keys (config.json)
  keys: Record<string, KeyMeta>;                           // keys.json
  locales: Record<string, Record<string, LocaleValue>>;    // locale -> key -> value
}

export function disassemble(state: State): SplitParts {
  const { keys, ...manifest } = state;
  const keyMeta: Record<string, KeyMeta> = {};
  const locales: Record<string, Record<string, LocaleValue>> = {};
  for (const [key, entry] of Object.entries(keys)) {
    const { values, ...meta } = entry;
    keyMeta[key] = meta;
    for (const [locale, lv] of Object.entries(values)) {
      (locales[locale] ??= {})[key] = lv;
    }
  }
  return { manifest, keys: keyMeta, locales };
}

// Inverse of disassemble. Returns a raw object for validate() to check/normalize.
// A locale value referencing a key absent from keys.json is tolerated (a minimal
// entry is created) so no data is ever dropped on load.
export function assemble(parts: SplitParts): unknown {
  const keys: Record<string, KeyEntry> = {};
  for (const [key, meta] of Object.entries(parts.keys)) {
    keys[key] = { ...meta, values: {} };
  }
  for (const [locale, entries] of Object.entries(parts.locales)) {
    for (const [key, lv] of Object.entries(entries)) {
      (keys[key] ??= { values: {} }).values[locale] = lv;
    }
  }
  return { ...parts.manifest, keys };
}

export function loadSplit(splitDir: string): unknown {
  const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  const manifest = readJson(join(splitDir, "config.json"));
  const keysPath = join(splitDir, "keys.json");
  const keys = existsSync(keysPath) ? readJson(keysPath) : {};
  const localesDir = join(splitDir, "locales");
  const locales: Record<string, Record<string, LocaleValue>> = {};
  if (existsSync(localesDir)) {
    for (const name of readdirSync(localesDir)) {
      if (name.endsWith(".json")) locales[name.slice(0, -5)] = readJson(join(localesDir, name));
    }
  }
  return assemble({ manifest, keys, locales });
}

function writeIfChanged(path: string, contents: string): boolean {
  let current: string | null = null;
  try { current = readFileSync(path, "utf8"); } catch { /* absent */ }
  if (current === contents) return false;
  writeFileAtomic(path, contents);
  return true;
}

export interface SaveSplitResult { written: number; skipped: number; deleted: number }

export function saveSplit(splitDir: string, state: State): SaveSplitResult {
  const fmt = state.config.format;
  const parts = disassemble(state);
  const localesDir = join(splitDir, "locales");
  mkdirSync(localesDir, { recursive: true });
  let written = 0;
  let skipped = 0;
  let deleted = 0;
  const track = (changed: boolean) => { if (changed) written++; else skipped++; };
  track(writeIfChanged(join(splitDir, "config.json"), serializeJson(parts.manifest, fmt)));
  track(writeIfChanged(join(splitDir, "keys.json"), serializeJson(parts.keys, fmt)));
  for (const [locale, entries] of Object.entries(parts.locales)) {
    track(writeIfChanged(join(localesDir, `${locale}.json`), serializeJson(entries, fmt)));
  }
  // Orphan cleanup: drop locale files whose locale no longer has any values.
  const live = new Set(Object.keys(parts.locales).map((l) => `${l}.json`));
  for (const name of readdirSync(localesDir)) {
    if (name.endsWith(".json") && !live.has(name)) { rmSync(join(localesDir, name)); deleted++; }
  }
  return { written, skipped, deleted };
}
