import { ref, computed, watch } from "vue";
import { getUiPrefs, putUiPrefs } from "@/api";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "glotfile-theme";
const MODES: ThemeMode[] = ["system", "light", "dark"];
const isMode = (v: unknown): v is ThemeMode => MODES.includes(v as ThemeMode);

// localStorage is per-origin, so it only acts as a fast, flash-free cache for the
// current port. The server-backed prefs file (synced below) is the source of
// truth that carries the choice across ports and instances.
function cachedMode(): ThemeMode {
  const raw = localStorage.getItem(KEY);
  return isMode(raw) ? raw : "system";
}

const mq = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(mq.matches);
mq.addEventListener("change", (e) => { systemDark.value = e.matches; });

export const mode = ref<ThemeMode>(cachedMode());
export const isDark = computed(() => (mode.value === "system" ? systemDark.value : mode.value === "dark"));

function apply(): void {
  document.documentElement.classList.toggle("dark", isDark.value);
}

// Apply synchronously on the resolved theme — once now (no flash) and again on
// every change, whether the user picks a mode or the OS flips while on "system".
export function initTheme(): void {
  watch(isDark, apply, { immediate: true, flush: "sync" });
}

export function setTheme(next: ThemeMode): void {
  mode.value = next;
  localStorage.setItem(KEY, next);
  void putUiPrefs({ theme: next }).catch(() => {});
}

// Reconcile with the machine-wide pref after mount. This is what lets a freshly
// opened instance (new port → empty localStorage) pick up a choice made elsewhere.
export async function syncFromServer(): Promise<void> {
  try {
    const { theme } = await getUiPrefs();
    if (isMode(theme) && theme !== mode.value) {
      mode.value = theme;
      localStorage.setItem(KEY, theme);
    }
  } catch {
    /* offline or API error: keep the cached/system theme */
  }
}
