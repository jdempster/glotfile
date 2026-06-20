// Per-developer choice of which locales the editor's multilingual view shows.
// Stored server-side in the project's gitignored .glotfile/settings.json (via
// /local-settings), NOT in the committed config — narrowing the view to the
// locales you own is personal and per-project, like the "open in editor" choice.
import { ref } from "vue";
import { getLocalSettings, putLocalSettings } from "@/api";
import { compareByLanguageName } from "@/languages";
import { getHashSearch } from "@/router";

// null = show every target locale (the default; locales added later fall into it).
// An array is a remembered subset of target-locale codes.
export const multilingualLocales = ref<string[] | null>(null);

export function setMultilingualLocales(v: string[] | null): void {
  multilingualLocales.value = v;
  void putLocalSettings({ multilingualLocales: v }).catch(() => {});
}

// Pull the per-project subset from the server on startup as the remembered
// default. A `locales` param in the URL takes precedence (a refresh or deep link
// must restore exactly what was on screen), so skip the default in that case.
// A failed fetch (offline) or an absent value leaves "show all" in place.
export async function hydrateMultilingualLocales(): Promise<void> {
  if (getHashSearch().has("locales")) return;
  try {
    const { multilingualLocales: m } = await getLocalSettings();
    multilingualLocales.value = Array.isArray(m) ? m : null;
  } catch {
    /* offline or API error: keep the default */
  }
}

// The subset after the picker toggles one locale. Keeps at least one target
// visible (an empty multilingual view is just the source), and collapses
// "every target selected" back to null so locales added later stay visible.
export function toggleMultilingual(
  targets: string[],
  selected: string[] | null,
  locale: string,
): string[] | null {
  const set = new Set(selected === null ? targets : targets.filter((l) => selected.includes(l)));
  if (set.has(locale)) {
    if (set.size === 1) return selected;
    set.delete(locale);
  } else {
    set.add(locale);
  }
  const arr = targets.filter((l) => set.has(l));
  return arr.length === targets.length ? null : arr;
}

// Locales the editor renders: source first, then targets sorted by language name
// (the same order the picker uses, so columns and dropdown agree). When `selected`
// is null every target shows; otherwise only the remembered subset, filtered to
// locales that still exist.
export function multilingualVisible(
  sourceLocale: string,
  allLocales: string[],
  selected: string[] | null,
): string[] {
  const targets = allLocales.filter((l) => l !== sourceLocale);
  const shown = selected === null ? targets : targets.filter((l) => selected.includes(l));
  return [sourceLocale, ...[...shown].sort(compareByLanguageName)];
}
