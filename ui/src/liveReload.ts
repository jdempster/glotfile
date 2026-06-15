import { onUnmounted } from "vue";
import { toast } from "@/components/ui/toast";

// Live reload: the server pushes a "state-changed" event over /api/events whenever
// the glotfile changes on disk out of band — a CLI sync/translate, a git restore,
// a hand edit. The active views re-fetch in place and a toast confirms it happened.

type Listener = () => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

// Open the SSE channel once, at app start. EventSource reconnects on its own if the
// dev server restarts, so there's nothing to tear down.
export function startLiveReload(): void {
  if (source) return;
  source = new EventSource("/api/events");
  source.addEventListener("state-changed", () => dispatchExternalChange());
}

// Toast, then re-run every subscribed view's refresh. Exported so it's callable
// directly in tests.
export function dispatchExternalChange(): void {
  toast("Reloaded — external change detected");
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
