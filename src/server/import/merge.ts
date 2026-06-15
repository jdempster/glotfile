import type { State, KeyEntry, LocaleValue } from "../schema.js";

// What a sync changed, relative to the existing catalog. Lists are sorted; the
// CLI prints counts and the UI renders the lists as a reviewable changeset.
export interface SyncPlan {
  // Keys present in the import but not in the existing catalog.
  added: string[];
  // Keys whose source value changed (or flipped scalar/plural shape).
  sourceChanged: string[];
  // Empty target locales filled from a non-empty incoming translation.
  adopted: { key: string; locale: string }[];
  // Keys in the existing catalog absent from the import (deleted or hash-churned).
  removed: string[];
  // Keys present in both with no source change and nothing adopted.
  unchanged: number;
}

// A locale entry counts as translated when a scalar has a non-blank value or a
// plural has a non-blank "other" form — mirrors findMissing in scan.ts.
function hasContent(lv: LocaleValue | undefined): boolean {
  if (!lv) return false;
  return !!(lv.forms ? lv.forms.other?.trim() : lv.value?.trim());
}

function formsEqual(a: LocaleValue["forms"], b: LocaleValue["forms"]): boolean {
  const ak = Object.keys(a ?? {}).sort();
  const bk = Object.keys(b ?? {}).sort();
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) => (a as Record<string, string>)[k] === (b as Record<string, string>)[k]);
}

// Same source text? A scalar↔plural shape flip always counts as changed.
function sameSource(cur: KeyEntry, inc: KeyEntry, src: string): boolean {
  if (!!cur.plural !== !!inc.plural) return false;
  const c = cur.values[src];
  const i = inc.values[src];
  return cur.plural ? formsEqual(c?.forms, i?.forms) : (c?.value ?? "") === (i?.value ?? "");
}

// Overwrite cur's source-locale value/shape from inc. On a shape flip the old
// target values are the wrong shape (scalar vs forms), so they're dropped — they
// can't be valid against the new shape and will be re-adopted from inc if present.
function applyIncomingSource(cur: KeyEntry, inc: KeyEntry, src: string, shapeChanged: boolean): void {
  const incSrc = inc.values[src];
  if (shapeChanged) {
    if (inc.plural) cur.plural = { arg: inc.plural.arg };
    else delete cur.plural;
    cur.values = { [src]: { ...incSrc, state: "source" } as LocaleValue };
    return;
  }
  const existing = cur.values[src];
  if (cur.plural) cur.values[src] = { ...existing, forms: incSrc?.forms, state: "source" } as LocaleValue;
  else cur.values[src] = { ...existing, value: incSrc?.value, state: "source" } as LocaleValue;
}

// Clone an incoming entry for insertion, keeping only configured locales and
// stamping target states as "reviewed" (a freshly-assembled import value).
function cloneForAdd(inc: KeyEntry, allowed: Set<string>): KeyEntry {
  const entry = structuredClone(inc);
  for (const loc of Object.keys(entry.values)) {
    if (!allowed.has(loc)) delete entry.values[loc];
  }
  return entry;
}

// Merge a freshly-assembled `incoming` State into `existing`, preserving everything
// glotfile owns — glossary, config, and per-key context/notes/tags/description/etc.
// Source values and the key set follow the import; translations are only adopted
// into empty locales (never downgraded). Removed keys are deleted only when prune.
export function mergeStates(
  existing: State,
  incoming: State,
  // liveKeys: the authoritative set of keys the import defines. When the parse
  // reads translation files alongside the source (Angular reads messages.xlf AND
  // glotfile's own messages.<locale>.xlf exports), a key deleted from the source
  // can linger in a stale translation file — so the source-locale key set, not the
  // merged parse, decides what's live. Defaults to every incoming key.
  opts: { prune?: boolean; liveKeys?: Set<string> } = {},
): { state: State; plan: SyncPlan } {
  const state = structuredClone(existing);
  const src = state.config.sourceLocale;
  const targets = state.config.locales.filter((l) => l !== src);
  const allowed = new Set(state.config.locales);
  const live = opts.liveKeys ?? new Set(Object.keys(incoming.keys));
  const plan: SyncPlan = { added: [], sourceChanged: [], adopted: [], removed: [], unchanged: 0 };

  for (const [key, inc] of Object.entries(incoming.keys)) {
    // A key present only in a stale translation file isn't live — skip it here;
    // if it's in the existing catalog the removed pass below will catch it.
    if (!live.has(key)) continue;
    const cur = state.keys[key];
    if (!cur) {
      const entry = cloneForAdd(inc, allowed);
      if (!entry.createdAt) entry.createdAt = new Date().toISOString();
      state.keys[key] = entry;
      plan.added.push(key);
      continue;
    }

    const shapeChanged = !!cur.plural !== !!inc.plural;
    const srcChanged = !sameSource(cur, inc, src);
    if (srcChanged) {
      applyIncomingSource(cur, inc, src, shapeChanged);
      plan.sourceChanged.push(key);
      // The source moved under the existing translations: keep their text but
      // flag them for re-check (a no-op when the shape flip already dropped them).
      for (const loc of targets) {
        const lv = cur.values[loc];
        if (lv && hasContent(lv)) lv.state = "needs-review";
      }
    }

    // Placeholders are derived from the source, so they follow the import.
    if (inc.placeholders) cur.placeholders = inc.placeholders;
    else delete cur.placeholders;
    // An imported description only fills a gap; a glotfile-edited one wins.
    if (!cur.description && inc.description) cur.description = inc.description;

    let adoptedHere = false;
    for (const loc of targets) {
      const incLv = inc.values[loc];
      if (!hasContent(incLv)) continue;
      if (hasContent(cur.values[loc])) continue;
      cur.values[loc] = { ...structuredClone(incLv!), state: "reviewed" };
      plan.adopted.push({ key, locale: loc });
      adoptedHere = true;
    }

    if (!srcChanged && !adoptedHere) plan.unchanged++;
  }

  for (const key of Object.keys(state.keys)) {
    if (!live.has(key)) {
      plan.removed.push(key);
      if (opts.prune) delete state.keys[key];
    }
  }

  plan.added.sort();
  plan.sourceChanged.sort();
  plan.removed.sort();
  plan.adopted.sort((a, b) => a.key.localeCompare(b.key) || a.locale.localeCompare(b.locale));
  return { state, plan };
}
