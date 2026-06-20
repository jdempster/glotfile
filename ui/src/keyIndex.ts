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
