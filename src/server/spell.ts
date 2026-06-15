import type { GlossaryEntry } from "./schema.js";

export interface Speller {
  correct(word: string): boolean;
}

const instances = new Map<string, Speller>();
const loading = new Set<string>();
const unavailable = new Set<string>();
const cache = new Map<string, string[]>();

const norm = (dictId: string) => dictId.toLowerCase();

// ICU plural/select blocks (one level of nesting) are masked entirely so branch
// selector keywords (other, few, custom enums) and branch text aren't flagged.
const ICU_BLOCK = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
const MASK = /\{[^}]*\}|<[^>]*>|:\w+|%[sd]/g;
const WORD = /\p{L}[\p{L}''’-]*/gu;

// The words of a value eligible for spell checking: ICU blocks, placeholders,
// tags and printf-style tokens are masked out first. Shared by the editor's
// live check and the lint rule so both flag exactly the same words.
export function spellTokens(value: string): string[] {
  return value.replace(ICU_BLOCK, " ").replace(MASK, " ").match(WORD) ?? [];
}

// Words never flagged as misspellings: glossary terms and their forced
// translations, plus the project's custom dictionary. Shared by the editor's
// live check and the lint rule.
export function ignoreWordsFor(glossary: GlossaryEntry[], customWords: string[] = []): Set<string> {
  const set = new Set<string>();
  const add = (text: string) => {
    for (const w of text.match(WORD) ?? []) set.add(w.toLowerCase());
  };
  for (const e of glossary) {
    add(e.term);
    for (const t of Object.values(e.translations ?? {})) add(t);
  }
  for (const w of customWords) add(w);
  return set;
}

// nspell and the dictionary packages are optional dependencies: a missing
// module just marks the dictionary unavailable. Add a locale by installing its
// `dictionary-<id>` package; config.spelling.locales maps locales to dict ids.
export async function getSpeller(dictId: string): Promise<Speller | null> {
  const key = norm(dictId);
  const existing = instances.get(key);
  if (existing) return existing;
  if (unavailable.has(key)) return null;
  try {
    const nspellMod: any = await import("nspell");
    const nspell = nspellMod.default ?? nspellMod;
    const dictMod: any = await import(`dictionary-${key}`);
    const dictExport = dictMod.default ?? dictMod;
    const dict = typeof dictExport === "function" ? await dictExport() : dictExport;
    const speller = nspell(dict) as Speller;
    instances.set(key, speller);
    return speller;
  } catch {
    unavailable.add(key);
    return null;
  } finally {
    loading.delete(key);
  }
}

export async function loadDictionary(dictId: string): Promise<void> {
  await getSpeller(dictId);
}

// Misspelled words for a value, [] if all correct or the dictionary is
// unavailable, or null if it is still loading (caller treats null as "pending").
export function spellValue(dictId: string, value: string, ignore: Set<string>): string[] | null {
  const key = norm(dictId);
  if (unavailable.has(key)) return [];
  const spell = instances.get(key);
  if (!spell) {
    if (!loading.has(key)) {
      loading.add(key);
      void getSpeller(key);
    }
    return null;
  }
  // Cache the RAW misspellings (pre-ignore); apply the caller's ignore set at read
  // time, since it derives from the glossary and can change between requests.
  const cacheKey = key + " " + value;
  let allBad = cache.get(cacheKey);
  if (!allBad) {
    allBad = spellTokens(value).filter((w) => !spell.correct(w));
    cache.set(cacheKey, allBad);
  }
  return allBad.filter((w) => !ignore.has(w.toLowerCase()));
}

export function resetSpellCacheForTests(): void {
  instances.clear();
  loading.clear();
  unavailable.clear();
  cache.clear();
}
