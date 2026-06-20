import { ref } from "vue";
import type { State } from "./types.js";

// The set of key paths currently in the project, kept in sync from App.vue's
// central state load. Lingo's chat messages consult it so that only real keys
// (not source strings, locale codes, or other backticked code spans) render as
// clickable links.
export const knownKeys = ref<Set<string>>(new Set());

export function syncKnownKeys(state: State | null): void {
  knownKeys.value = new Set(state ? Object.keys(state.keys) : []);
}

// The project's TARGET locales (lowercased, source excluded), kept in sync the
// same way. Lingo's mentions of a locale like `de` become clickable links that
// focus the editor on it — source isn't a filterable target, so it's left out.
export const knownLocales = ref<Set<string>>(new Set());

export function syncKnownLocales(state: State | null): void {
  if (!state) { knownLocales.value = new Set(); return; }
  const source = state.config.sourceLocale;
  knownLocales.value = new Set(
    state.config.locales.filter((l) => l !== source).map((l) => l.toLowerCase()),
  );
}

// Register a single key as known immediately — used when Lingo CREATES a key
// mid-conversation, so its mention in the same turn renders as a clickable link
// without waiting for the turn-end state reload. A fresh Set keeps it reactive.
export function addKnownKey(key: string): void {
  if (knownKeys.value.has(key)) return;
  const next = new Set(knownKeys.value);
  next.add(key);
  knownKeys.value = next;
}
