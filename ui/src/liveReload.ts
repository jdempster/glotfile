import { onUnmounted, ref } from "vue";

// Live reload: the server pushes a "state-changed" event over /api/events whenever
// the glotfile changes out of band — a CLI sync/translate, a git restore, a hand
// edit, or Lingo editing via a tool. The active views re-fetch in place; a brief
// spinner in the header hints the refresh happened, instead of a noisier toast.

type Listener = () => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

// Flips true for a beat each time data reloads, so the header can flash a small
// spinner. Module-level so it survives view switches and is shared by all callers.
export const refreshing = ref(false);
let flashTimer: ReturnType<typeof setTimeout> | undefined;

// Open the SSE channel once, at app start. EventSource reconnects on its own if the
// dev server restarts, so there's nothing to tear down.
export function startLiveReload(): void {
  if (source) return;
  source = new EventSource("/api/events");
  source.addEventListener("state-changed", () => dispatchExternalChange());
}

// Flash the indicator, then re-run every subscribed view's refresh. Exported so
// it's callable directly in tests.
export function dispatchExternalChange(): void {
  // A short pulse: long enough to register as "something just updated", short
  // enough not to linger. A fresh change restarts the timer.
  refreshing.value = true;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { refreshing.value = false; }, 1600);
  for (const listener of [...listeners]) {
    // One view's refresh throwing must not stop the others from updating.
    try {
      listener();
    } catch { /* ignore */ }
  }
}

// Views call this in setup() to re-fetch when an external change lands. The
// listener is removed automatically when the component unmounts.
export function onExternalChange(listener: Listener): void {
  listeners.add(listener);
  onUnmounted(() => {
    listeners.delete(listener);
  });
}
