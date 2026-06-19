import type { State, KeyEntry, LocaleState, PluralForm, LocaleValue } from "./schema.js";
import {
  canonLocale, createKey, setSourceValue, setTargetValue, setSourcePluralForms,
  setPluralForms, setKeyState, clearValue, type Clock, systemClock,
} from "./state.js";
import { cellState, type EffectiveState } from "./cell-state.js";
import { globToRegExp } from "./glob.js";
import { parseSearch, keyMatchesSearch } from "./search.js";

// ---------------------------------------------------------------------------
// get — surgical, filtered extraction so an agent never has to load the whole
// catalog. Pure: takes a State, returns plain data the CLI serializes.
// ---------------------------------------------------------------------------

export interface GetOptions {
  // Union of key globs (e.g. ["auth.*", "checkout.title"]); empty/undefined = all keys.
  keyGlobs?: string[];
  // Locales to show, in order. Default: every configured locale (source included).
  locales?: string[];
  // Key selector: include a key only if one of its shown target locales is in
  // one of these effective states. The source locale is always shown as the
  // reference and never gates this predicate.
  states?: EffectiveState[];
  // Cell projection. Default ["value", "state"]. "all" => the full key entry.
  fields?: string[];
  // Scoped/regex text search over key/value/context (see parseSearch); ANDed with
  // keyGlobs and states. E.g. "value:Sign in", "key:auth", "context:button", "/^auth\\./".
  search?: string;
}

interface GetCell {
  value?: string;
  forms?: Partial<Record<PluralForm, string>>;
  state: EffectiveState;
}

export interface GetOutput {
  // Matched key names, sorted — the cheapest overview (`--keys-only`).
  keys: string[];
  // { key -> { locale -> projected cell } }, or { key -> full entry } in "all" mode.
  json: Record<string, unknown>;
  // One flat row per (key, locale) cell, or per key in "all" mode — stream-friendly.
  ndjson: Record<string, unknown>[];
}

function projectCell(cell: GetCell, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f === "value" && cell.value !== undefined) out.value = cell.value;
    else if (f === "value" && cell.forms !== undefined) out.forms = cell.forms;
    else if (f === "state") out.state = cell.state;
  }
  return out;
}

export function runGet(state: State, opts: GetOptions): GetOutput {
  const { sourceLocale } = state.config;
  const shown = (opts.locales?.length ? opts.locales : state.config.locales).map(canonLocale);
  const targetsShown = shown.filter((l) => l !== sourceLocale);
  const res = opts.keyGlobs?.length ? opts.keyGlobs.map(globToRegExp) : null;
  const search = opts.search?.trim() ? parseSearch(opts.search) : null;
  const stateSet = opts.states?.length ? new Set(opts.states) : null;
  const fields = opts.fields?.length ? opts.fields : ["value", "state"];
  const fullEntry = fields.includes("all");

  const keys: string[] = [];
  const json: Record<string, unknown> = {};
  const ndjson: Record<string, unknown>[] = [];

  for (const key of Object.keys(state.keys).sort()) {
    if (res && !res.some((re) => re.test(key))) continue;
    const entry = state.keys[key]!;
    if (search && !keyMatchesSearch(key, entry, search)) continue;
    // State selector gates on the shown *target* locales only.
    if (stateSet && !targetsShown.some((l) => stateSet.has(cellState(entry, l, sourceLocale)))) continue;
    keys.push(key);

    if (fullEntry) {
      // Whole entry, but with values narrowed to the shown locales.
      const values: Record<string, LocaleValue> = {};
      for (const l of shown) if (entry.values[l]) values[l] = entry.values[l]!;
      json[key] = { ...entry, values };
      ndjson.push({ key, ...entry, values });
      continue;
    }

    const cells: Record<string, unknown> = {};
    for (const locale of shown) {
      const st = cellState(entry, locale, sourceLocale);
      // With a state filter, show the matching target cells plus the source ref.
      if (stateSet && locale !== sourceLocale && !stateSet.has(st)) continue;
      const lv = entry.values[locale];
      const cell: GetCell = entry.plural
        ? { forms: lv?.forms ?? {}, state: st }
        : { value: lv?.value ?? "", state: st };
      const projected = projectCell(cell, fields);
      cells[locale] = projected;
      ndjson.push({ key, locale, ...projected });
    }
    json[key] = cells;
  }

  return { keys, json, ndjson };
}

// ---------------------------------------------------------------------------
// apply — a batch of write operations applied in one load -> mutate -> save, so
// an agent can make many edits to a large catalog without N file rewrites.
// ---------------------------------------------------------------------------

export type ApplyOp =
  | { op: "create"; key: string; value: string }
  | { op: "set-source"; key: string; value: string }
  | { op: "set-target"; key: string; locale: string; value: string; state?: LocaleState }
  | { op: "set-source-forms"; key: string; forms: Record<string, string> }
  | { op: "set-forms"; key: string; locale: string; forms: Record<string, string>; state?: LocaleState }
  | { op: "set-state"; key: string; locale: string; state: LocaleState }
  | { op: "clear"; key: string; locale: string };

export interface ApplyOptions {
  // Keep going past a failing op (collect errors) instead of stopping at the first.
  continueOnError?: boolean;
  clock?: Clock;
}

export interface ApplyResult {
  applied: number;
  keysTouched: string[];
  errors: { index: number; op?: string; key?: string; error: string }[];
}

function applyOne(state: State, op: ApplyOp, clock: Clock): void {
  switch (op.op) {
    case "create": createKey(state, op.key, op.value, clock); return;
    case "set-source": setSourceValue(state, op.key, op.value); return;
    case "set-target":
      setTargetValue(state, op.key, op.locale, op.value);
      if (op.state && op.state !== "reviewed") setKeyState(state, op.key, op.locale, op.state);
      return;
    case "set-source-forms": setSourcePluralForms(state, op.key, op.forms); return;
    case "set-forms":
      setPluralForms(state, op.key, op.locale, op.forms);
      if (op.state && op.state !== "reviewed") setKeyState(state, op.key, op.locale, op.state);
      return;
    case "set-state": setKeyState(state, op.key, op.locale, op.state); return;
    case "clear": clearValue(state, op.key, op.locale); return;
    default: throw new Error(`Unknown op: ${(op as { op?: string }).op ?? "(missing)"}`);
  }
}

// Parse + shape-check stdin JSON into a list of ops. Throws on anything that
// isn't an array of `{op, ...}` objects, so a malformed batch fails loudly.
export function parseOps(raw: string): ApplyOp[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`apply expects a JSON array of operations on stdin: ${(e as Error).message}`);
  }
  if (!Array.isArray(data)) throw new Error("apply expects a JSON array of operations on stdin");
  return data.map((o, i) => {
    if (!o || typeof o !== "object" || typeof (o as { op?: unknown }).op !== "string") {
      throw new Error(`operation ${i} is not an { "op": ... } object`);
    }
    return o as ApplyOp;
  });
}

export function applyOps(state: State, ops: ApplyOp[], opts: ApplyOptions = {}): ApplyResult {
  const clock = opts.clock ?? systemClock;
  const touched = new Set<string>();
  const errors: ApplyResult["errors"] = [];
  let applied = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    try {
      applyOne(state, op, clock);
      applied++;
      if (op.key) touched.add(op.key);
    } catch (e) {
      errors.push({ index: i, op: op.op, key: op.key, error: e instanceof Error ? e.message : String(e) });
      if (!opts.continueOnError) break;
    }
  }
  return { applied, keysTouched: [...touched].sort(), errors };
}

// Count how many of a key's target translations setSourceValue would invalidate,
// so `set` can report the side effect ("3 translations flipped to needs-review").
export function staleableTargets(entry: KeyEntry | undefined, sourceLocale: string): number {
  if (!entry) return 0;
  let n = 0;
  for (const [locale, lv] of Object.entries(entry.values)) {
    if (locale === sourceLocale) continue;
    if (lv.state === "reviewed" || lv.state === "machine") n++;
  }
  return n;
}
