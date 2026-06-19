import { readFileSync, existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { serializeJson } from "./format.js";
import { writeFileAtomic } from "./atomic-write.js";
import {
  validate, defaultState, GlotfileError, isPluralForm, CURRENT_VERSION, STATES,
  type State, type LocaleState, type KeyEntry, type GlossaryEntry, type Note, type PluralCategory, type PluralForm, type GlossarySuggestion,
} from "./schema.js";
import { formsToIcu } from "./plurals.js";
import { splitDirFor, detectFormat, loadSplit, saveSplit } from "./storage.js";
import { normalizeSource } from "./normalize.js";
import { sourceHash, pruneStaleSuppressions } from "./lint/suppress.js";
import { RULE_IDS, type RuleId } from "./lint/registry.js";

export type Clock = () => string;
export const systemClock: Clock = () => new Date().toISOString();

// Canonical locale form: lowercase BCP-47 (hyphen-separated), so `Intl` accepts
// it directly and the file never stores ad-hoc variants like "EN_US". Exporters
// that want a different separator (gettext/Laravel/Flutter use "_") map it at
// export time via locale aliasing.
export function canonLocale(locale: string): string {
  return locale.trim().toLowerCase().replace(/_/g, "-");
}

// Keep config deterministic: canonical codes, deduped case-insensitively,
// ordered source-first then alphabetical. Applied on load (so the UI sees a
// stable order) and on save (so the file diffs minimally). The locale keys
// inside every entry's `values` are canonicalized too, so a translation stored
// under "en_US" stays attached when the code becomes "en-us".
function normalizeState(state: State): void {
  const src = canonLocale(state.config.sourceLocale);
  state.config.sourceLocale = src;
  // Stamp current version unconditionally — no migration chain exists yet.
  state.version = CURRENT_VERSION;
  const seen = new Set<string>([src]);
  for (const l of state.config.locales) {
    const c = canonLocale(l);
    if (c) seen.add(c);
  }
  const rest = [...seen].filter((l) => l !== src).sort();
  state.config.locales = [src, ...rest];
  for (const entry of Object.values(state.keys)) {
    const remapped: typeof entry.values = {};
    for (const [loc, lv] of Object.entries(entry.values)) remapped[canonLocale(loc)] = lv;
    entry.values = remapped;
    for (const s of entry.suppressions ?? []) s.locale = canonLocale(s.locale);
  }
  for (const output of state.config.outputs) {
    if (!output.localeMap) continue;
    const remapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(output.localeMap)) remapped[canonLocale(k)] = v;
    output.localeMap = remapped;
  }
  if (state.config.localeInstructions) {
    const remapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(state.config.localeInstructions)) remapped[canonLocale(k)] = v;
    state.config.localeInstructions = remapped;
  }
}

export function loadState(path: string): State {
  const fmt = detectFormat(path);
  if (fmt === "none") return defaultState();
  let raw: unknown;
  try {
    raw = fmt === "split" ? loadSplit(splitDirFor(path)) : JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new GlotfileError(`Could not load ${path}: ${(e as Error).message}`);
  }
  const state = validate(raw);
  normalizeState(state);
  return state;
}

export function saveState(path: string, state: State): void {
  normalizeState(state);
  if (state.config.storage === "split") {
    saveSplit(splitDirFor(path), state);
    // Drop a single file left behind by a pre-split save (post-promotion hygiene).
    if (existsSync(path)) rmSync(path);
  } else {
    writeFileAtomic(path, serializeJson(state, state.config.format));
  }
}

function requireKey(state: State, key: string): KeyEntry {
  const entry = state.keys[key];
  if (!entry) throw new GlotfileError(`No such key: ${key}`);
  return entry;
}

function requirePlural(state: State, key: string): KeyEntry {
  const entry = requireKey(state, key);
  if (!entry.plural) throw new GlotfileError(`Key is not a plural: ${key}`);
  return entry;
}

// Validate + trim form bodies at every plural write boundary so a bad payload
// (e.g. unvalidated client JSON) can never persist a self-inconsistent catalog
// that fails to reload. Trimming matches the scalar contract (stored values
// never carry surrounding whitespace).
function normalizeForms(forms: Partial<Record<PluralForm, string>>): Partial<Record<PluralForm, string>> {
  const out: Partial<Record<PluralForm, string>> = {};
  for (const [cat, body] of Object.entries(forms)) {
    // A selector is a CLDR category (one, other, …) or an explicit value match (=1).
    if (!isPluralForm(cat)) throw new GlotfileError(`Invalid plural category: ${cat}`);
    if (typeof body !== "string") throw new GlotfileError(`Plural form "${cat}" must be a string`);
    out[cat as PluralForm] = body.trim();
  }
  if (typeof out.other !== "string") throw new GlotfileError(`Plural forms must include the "other" form`);
  return out;
}

export interface CreateKeyOptions {
  plural?: { arg: string };
}

export function createKey(
  state: State,
  key: string,
  sourceValue: string,
  clock: Clock = systemClock,
  opts: CreateKeyOptions = {},
): void {
  if (state.keys[key]) throw new GlotfileError(`Key already exists: ${key}`);
  const sl = state.config.sourceLocale;
  if (opts.plural) {
    state.keys[key] = {
      createdAt: clock(),
      plural: { arg: opts.plural.arg },
      // The source value seeds the required "other" form so nothing is empty.
      values: { [sl]: { forms: { other: sourceValue.trim() }, state: "source" } },
    };
  } else {
    state.keys[key] = {
      createdAt: clock(),
      values: { [sl]: { value: sourceValue.trim(), state: "source" } },
    };
  }
}

export function renameKey(state: State, from: string, to: string): void {
  if (from === to) return;
  const entry = requireKey(state, from);
  if (state.keys[to]) throw new GlotfileError(`Key already exists: ${to}`);
  delete state.keys[from];
  state.keys[to] = entry;
}

export function deleteKey(state: State, key: string): void {
  requireKey(state, key);
  delete state.keys[key];
}

// A key's source is "empty" when its source-locale text is blank — scalar value
// blank, or (for plurals) the required "other" form blank. Mirrors the editor's
// isMissing(entry, sourceLocale) in ui/src/filter.ts (separate build unit).
function isSourceEmpty(entry: KeyEntry, sourceLocale: string): boolean {
  const lv = entry.values[sourceLocale];
  if (!lv) return true;
  const text = entry.plural ? (lv.forms?.other ?? "") : (lv.value ?? "");
  return text.trim() === "";
}

export function findEmptySourceKeys(state: State): string[] {
  return Object.keys(state.keys)
    .filter((k) => isSourceEmpty(state.keys[k]!, state.config.sourceLocale))
    .sort();
}

export function pruneEmptySourceKeys(state: State): string[] {
  const removed = findEmptySourceKeys(state);
  for (const k of removed) delete state.keys[k];
  return removed;
}

export function setSourceValue(state: State, key: string, value: string): void {
  const entry = requireKey(state, key);
  if (entry.plural) throw new GlotfileError(`Key is a plural; use the plural setters: ${key}`);
  const oldNorm = normalizeSource(entry.values[state.config.sourceLocale]?.value ?? "");
  const newNorm = normalizeSource(value);
  entry.values[state.config.sourceLocale] = { value: value.trim(), state: "source" };
  if (oldNorm !== newNorm) {
    for (const [locale, lv] of Object.entries(entry.values)) {
      if (locale === state.config.sourceLocale) continue;
      if (lv.state === "reviewed" || lv.state === "machine") {
        lv.state = "needs-review";
      }
    }
    pruneStaleSuppressions(entry, state.config.sourceLocale);
  }
}

export function setTargetValue(state: State, key: string, locale: string, value: string): void {
  const entry = requireKey(state, key);
  if (entry.plural) throw new GlotfileError(`Key is a plural; use the plural setters: ${key}`);
  entry.values[canonLocale(locale)] = { value: value.trim(), state: "reviewed" };
}

function formSignature(forms: Partial<Record<PluralForm, string>>): string {
  return Object.entries(forms)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, val]) => `${cat}:${normalizeSource(val ?? "")}`)
    .join("|");
}

export function setSourcePluralForms(state: State, key: string, forms: Partial<Record<PluralForm, string>>): void {
  const entry = requirePlural(state, key);
  const normalized = normalizeForms(forms);
  const oldSig = formSignature(entry.values[state.config.sourceLocale]?.forms ?? {});
  const newSig = formSignature(normalized);
  entry.values[state.config.sourceLocale] = { forms: normalized, state: "source" };
  if (oldSig !== newSig) {
    for (const [locale, lv] of Object.entries(entry.values)) {
      if (locale === state.config.sourceLocale) continue;
      if (lv.state === "reviewed" || lv.state === "machine") {
        lv.state = "needs-review";
      }
    }
    pruneStaleSuppressions(entry, state.config.sourceLocale);
  }
}

export function setPluralForms(
  state: State,
  key: string,
  locale: string,
  forms: Partial<Record<PluralForm, string>>,
): void {
  const entry = requirePlural(state, key);
  const loc = canonLocale(locale);
  if (loc === state.config.sourceLocale) throw new GlotfileError("Use setSourcePluralForms for the source locale");
  entry.values[loc] = { forms: normalizeForms(forms), state: "reviewed" };
}

export function convertToPlural(state: State, key: string, arg: string): void {
  const entry = requireKey(state, key);
  if (entry.plural) throw new GlotfileError(`Key is already a plural: ${key}`);
  entry.plural = { arg };
  for (const lv of Object.values(entry.values)) {
    // The existing scalar text becomes the required "other" form — no data lost.
    lv.forms = { other: lv.value ?? "" };
    delete lv.value;
  }
}

export function setPluralArg(state: State, key: string, arg: string): void {
  const entry = requireKey(state, key);
  if (!entry.plural) throw new GlotfileError(`Key is not a plural: ${key}`);
  entry.plural = { arg };
}

export function convertToScalar(state: State, key: string): void {
  const entry = requirePlural(state, key);
  const arg = entry.plural!.arg;
  for (const lv of Object.values(entry.values)) {
    const forms = lv.forms ?? {};
    // A lone "other" collapses to plain text; richer form sets serialize to ICU
    // so the information survives the round-trip.
    lv.value = Object.keys(forms).length <= 1 ? (forms.other ?? "") : formsToIcu(arg, forms);
    delete lv.forms;
  }
  delete entry.plural;
}

export function clearValue(state: State, key: string, locale: string): void {
  const entry = requireKey(state, key);
  const loc = canonLocale(locale);
  if (loc === state.config.sourceLocale) throw new GlotfileError("Cannot clear the source value");
  delete entry.values[loc];
}

export function setKeyState(state: State, key: string, locale: string, next: LocaleState): void {
  // Guard against a bogus state slipping in from client JSON: saveState does not
  // re-validate, so an unknown value would persist and then make loadState throw.
  if (!STATES.includes(next)) throw new GlotfileError(`Unknown translation state: ${next}`);
  const entry = requireKey(state, key);
  const loc = canonLocale(locale);
  const lv = entry.values[loc];
  if (!lv) throw new GlotfileError(`No value for ${key} @ ${locale}`);
  lv.state = next;
}

export function setMetadata(state: State, key: string, partial: Partial<Omit<KeyEntry, "values" | "plural">>): void {
  const entry = requireKey(state, key);
  // Pluralness and values are owned by the dedicated ops (convertToPlural/
  // convertToScalar and the form setters), which keep the value/forms shape
  // consistent. A metadata merge must never change them — this also hardens the
  // API PATCH boundary, where `partial` is unvalidated client JSON.
  const safe = { ...partial } as Partial<KeyEntry>;
  delete safe.plural;
  delete safe.values;
  // A human write to `context` promotes it from AI-generated to human-authored.
  if ("context" in safe) {
    delete entry.contextSource;
  }
  Object.assign(entry, safe);
  // Empty is represented by absence, not a stored empty value: a field cleared in
  // the editor must round-trip as "unset" rather than persisting "" / [] / null.
  if ("context" in safe && !entry.context) delete entry.context;
  if ("tags" in safe && !entry.tags?.length) delete entry.tags;
  if ("maxLength" in safe && !entry.maxLength) delete entry.maxLength;
}

export function addNote(state: State, key: string, text: string, clock: Clock = systemClock): Note {
  const entry = requireKey(state, key);
  const note: Note = { id: "n_" + randomUUID(), text, at: clock() };
  (entry.notes ??= []).push(note);
  return note;
}

export function editNote(state: State, key: string, id: string, text: string): void {
  const entry = requireKey(state, key);
  const note = entry.notes?.find((n) => n.id === id);
  if (!note) throw new GlotfileError(`No such note: ${id}`);
  note.text = text;
}

export function deleteNote(state: State, key: string, id: string): void {
  const entry = requireKey(state, key);
  if (!entry.notes) return;
  entry.notes = entry.notes.filter((n) => n.id !== id);
}

export function addLocale(state: State, locale: string): void {
  const code = canonLocale(locale);
  if (!code) return;
  if (state.config.locales.some((l) => canonLocale(l) === code)) return;
  state.config.locales.push(code);
}

export function removeLocale(state: State, locale: string): void {
  const code = canonLocale(locale);
  if (code === state.config.sourceLocale) {
    throw new GlotfileError(`Cannot remove the source locale: ${locale}`);
  }
  state.config.locales = state.config.locales.filter((l) => canonLocale(l) !== code);
  for (const entry of Object.values(state.keys)) {
    delete entry.values[code];
    if (entry.suppressions) {
      entry.suppressions = entry.suppressions.filter((s) => canonLocale(s.locale) !== code);
      if (!entry.suppressions.length) delete entry.suppressions;
    }
  }
}

export function addSuppression(state: State, key: string, rule: string, locale: string): void {
  const entry = requireKey(state, key);
  if (!RULE_IDS.includes(rule as RuleId)) throw new GlotfileError(`Unknown lint rule: ${rule}`);
  const list = (entry.suppressions ?? []).filter((s) => !(s.rule === rule && s.locale === locale));
  list.push({ rule: rule as RuleId, locale, source: sourceHash(entry, state.config.sourceLocale) });
  entry.suppressions = list;
}

export function removeSuppression(state: State, key: string, rule: string, locale: string): void {
  const entry = requireKey(state, key);
  if (!entry.suppressions) return;
  entry.suppressions = entry.suppressions.filter((s) => !(s.rule === rule && s.locale === locale));
  if (!entry.suppressions.length) delete entry.suppressions;
}

export function upsertGlossaryEntry(state: State, entry: GlossaryEntry): void {
  const i = state.glossary.findIndex((e) => e.term === entry.term);
  if (i === -1) state.glossary.push(entry);
  else state.glossary[i] = entry;
}

export function deleteGlossaryEntry(state: State, term: string): void {
  state.glossary = state.glossary.filter((e) => e.term !== term);
}

function normGlossaryTerm(term: string): string {
  return term.trim().toLowerCase();
}

// Add detected terms as pending suggestions, skipping any whose normalized term
// already exists in the glossary or in the suggestion queue (pending OR
// dismissed — a dismissed term is a tombstone that must never resurface).
// Returns the entries actually added.
export function mergeGlossarySuggestions(
  state: State,
  found: Array<{ term: string; note?: string; doNotTranslate?: boolean; caseSensitive?: boolean; wholeWord?: boolean }>,
): GlossarySuggestion[] {
  const known = new Set<string>();
  for (const g of state.glossary) known.add(normGlossaryTerm(g.term));
  for (const s of state.glossarySuggestions) known.add(normGlossaryTerm(s.term));
  const added: GlossarySuggestion[] = [];
  for (const f of found) {
    const term = f.term.trim();
    if (!term) continue;
    const key = normGlossaryTerm(term);
    if (known.has(key)) continue;
    known.add(key);
    const sug: GlossarySuggestion = { term, status: "pending" };
    if (f.note?.trim()) sug.note = f.note.trim();
    if (f.doNotTranslate) sug.doNotTranslate = true;
    if (f.caseSensitive) sug.caseSensitive = true;
    if (f.wholeWord === false) sug.wholeWord = false;
    state.glossarySuggestions.push(sug);
    added.push(sug);
  }
  return added;
}

export function dismissGlossarySuggestion(state: State, term: string): void {
  const key = normGlossaryTerm(term);
  const s = state.glossarySuggestions.find((x) => normGlossaryTerm(x.term) === key);
  if (s) s.status = "dismissed";
}

export function removeGlossarySuggestion(state: State, term: string): void {
  const key = normGlossaryTerm(term);
  state.glossarySuggestions = state.glossarySuggestions.filter((x) => normGlossaryTerm(x.term) !== key);
}

export function addCustomWord(state: State, word: string): void {
  const w = word.trim();
  if (!w) return;
  const spelling = (state.config.spelling ??= { customWords: [] });
  if (!spelling.customWords.includes(w)) {
    spelling.customWords.push(w);
    spelling.customWords.sort();
  }
}

export function removeCustomWord(state: State, word: string): void {
  const spelling = state.config.spelling;
  if (!spelling) return;
  spelling.customWords = spelling.customWords.filter((w) => w !== word);
}

// Returns false (no write) if the target is reviewed (FR-21), unless `force` is set —
// an explicit per-cell re-translate overwrites a reviewed value (and resets it to machine).
export function applyMachineTranslation(state: State, key: string, locale: string, value: string, force = false): boolean {
  const entry = requireKey(state, key);
  if (entry.plural) throw new GlotfileError(`Key is a plural; use applyMachineTranslationForms: ${key}`);
  const loc = canonLocale(locale);
  if (!force && entry.values[loc]?.state === "reviewed") return false;
  entry.values[loc] = { value: value.trim(), state: "machine", source: "ai" };
  return true;
}

// Forms equivalent of applyMachineTranslation: honours the reviewed-guard
// (FR-21) and stamps machine/ai. Returns false (no write) when the
// target is already reviewed, unless `force` is set (an explicit re-translate).
export function applyMachineTranslationForms(
  state: State,
  key: string,
  locale: string,
  forms: Partial<Record<PluralCategory, string>>,
  force = false,
): boolean {
  const entry = requirePlural(state, key);
  const loc = canonLocale(locale);
  if (!force && entry.values[loc]?.state === "reviewed") return false;
  entry.values[loc] = { forms: normalizeForms(forms), state: "machine", source: "ai" };
  return true;
}
