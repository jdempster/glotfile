import { ref, type Ref } from "vue";
import { getUiPrefs, putUiPrefs, type UiPrefs } from "@/api";

// Resizable sidebar widths. Like the theme, localStorage is only a per-origin
// flash-free cache; the server-backed prefs file (~/.glotfile/ui.json) is the
// source of truth that carries the widths across ports and instances.

interface PanelWidth {
  width: Ref<number>;
  min: number;
  max: number;
  // Live update during a drag (clamped); not persisted until commit.
  set: (px: number) => void;
  // Persist the current width to localStorage and the machine-wide prefs file.
  commit: () => void;
  // Back to the built-in default (double-click on the handle).
  reset: () => void;
  syncValue: (v: unknown) => void;
}

function panelWidth(prefKey: "keyColumnWidth" | "detailPanelWidth" | "chatPanelWidth", def: number, min: number, max: number): PanelWidth {
  const storageKey = `glotfile-${prefKey}`;
  const clamp = (px: number) => Math.min(max, Math.max(min, Math.round(px)));
  const cached = () => {
    const raw = Number(localStorage.getItem(storageKey));
    return Number.isFinite(raw) && raw > 0 ? clamp(raw) : def;
  };
  const width = ref(cached());
  const commit = () => {
    localStorage.setItem(storageKey, String(width.value));
    void putUiPrefs({ [prefKey]: width.value }).catch(() => {});
  };
  return {
    width,
    min,
    max,
    set: (px) => { width.value = clamp(px); },
    commit,
    reset: () => {
      width.value = def;
      commit();
    },
    syncValue: (v) => {
      if (typeof v === "number" && Number.isFinite(v)) {
        width.value = clamp(v);
        localStorage.setItem(storageKey, String(width.value));
      }
    },
  };
}

// Defaults match the previously hard-coded Tailwind widths.
export const keyColumn = panelWidth("keyColumnWidth", 272, 180, 560);
export const detailPanel = panelWidth("detailPanelWidth", 420, 320, 720);
export const chatPanel = panelWidth("chatPanelWidth", 416, 320, 720);

interface PanelToggle {
  open: Ref<boolean>;
  toggle: () => void;
  syncValue: (v: unknown) => void;
}

// A shown/hidden flag persisted the same way as the widths: localStorage for a
// flash-free boot, the prefs file as the cross-port source of truth.
function panelToggle(prefKey: "detailPanelOpen", def: boolean): PanelToggle {
  const storageKey = `glotfile-${prefKey}`;
  const cached = () => {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? def : raw === "true";
  };
  const open = ref(cached());
  const persist = () => {
    localStorage.setItem(storageKey, String(open.value));
    void putUiPrefs({ [prefKey]: open.value }).catch(() => {});
  };
  return {
    open,
    toggle: () => {
      open.value = !open.value;
      persist();
    },
    syncValue: (v) => {
      if (typeof v === "boolean") {
        open.value = v;
        localStorage.setItem(storageKey, String(v));
      }
    },
  };
}

export const detailPanelToggle = panelToggle("detailPanelOpen", true);

// Reconcile with the machine-wide prefs after mount, same as the theme.
export async function syncPanelWidths(prefs?: UiPrefs): Promise<void> {
  try {
    const p = prefs ?? (await getUiPrefs());
    keyColumn.syncValue(p.keyColumnWidth);
    detailPanel.syncValue(p.detailPanelWidth);
    chatPanel.syncValue(p.chatPanelWidth);
    detailPanelToggle.syncValue(p.detailPanelOpen);
  } catch {
    /* offline or API error: keep the cached widths */
  }
}
