import { ref } from "vue";
import type { KeyFilter } from "./filter.js";
import { navigate } from "./router.js";

// Set by the Analytics view just before navigating to the editor; the editor
// reads and clears it on (re)mount. The hash router carries no query state, so
// this module is the channel.
export const pendingFilter = ref<Partial<KeyFilter> | null>(null);

export function drillTo(f: Partial<KeyFilter>): void {
  pendingFilter.value = f;
  navigate("editor");
}

// Key to select (opening its detail panel) when the editor next mounts.
export const pendingKey = ref<string | null>(null);

// Jump to one specific key: filter the list to it and open its detail panel.
export function drillToKey(key: string): void {
  pendingKey.value = key;
  drillTo({ text: key });
}

// Open a key's detail panel WITHOUT touching the list filter (Lingo's select_key,
// which composes with a separate filter_view). Navigates to the editor first so
// it works from any view.
export function selectKey(key: string): void {
  pendingKey.value = key;
  navigate("editor");
}
