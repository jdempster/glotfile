import { ref, onMounted, onUnmounted } from "vue";
import { navigate } from "@/router";
import { reduceChord, type ChordState } from "@/hotkeys";

// Module-level singleton so ShortcutsDialog can v-model:open it while the
// listener below toggles it — both sides share this one ref.
export const shortcutsOpen = ref(false);

// The armed "g" auto-resets after this long with no second key.
const CHORD_TIMEOUT_MS = 1000;

// One global keydown listener (owned by App.vue) driving the pure chord reducer.
// The only place that touches window, timers, and navigate().
export function useNavHotkeys(): void {
  let state: ChordState = { pending: null };
  let timer: number | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    // Guards lifted from EditorView.onKeydown so the two handlers behave
    // identically and never hijack typing or fight a browser shortcut.
    // (Shift is intentionally not guarded — "?" is Shift+/.)
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

    const key = e.key.toLowerCase();
    // An open popover/menu/dialog swallows the chord — except "?" is let through
    // when the shortcuts overlay itself is open, so "?" toggles it shut (§7).
    const overlayOpen = !!document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]');
    const allowQuestionToClose = key === "?" && shortcutsOpen.value;
    if (overlayOpen && !allowQuestionToClose) return;

    const result = reduceChord(state, key);
    state = result.state;
    clearTimer();
    if (state.pending === "g") {
      timer = window.setTimeout(() => {
        state = { pending: null };
        timer = null;
      }, CHORD_TIMEOUT_MS);
    }

    const { action } = result;
    if (!action) return;
    if (action.type === "navigate") navigate(action.route);
    else shortcutsOpen.value = !shortcutsOpen.value;
    e.preventDefault();
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onUnmounted(() => {
    clearTimer();
    window.removeEventListener("keydown", onKeydown);
  });
}
