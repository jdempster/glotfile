import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import EditorView from "./EditorView.vue";
import SelectionBar from "./SelectionBar.vue";
import TranslateDialog from "./TranslateDialog.vue";
import { multilingualLocales } from "@/multilingualLocales.js";
import type { State } from "@/types.js";

vi.mock("@/api.js", () => ({
  fetchState: vi.fn(),
  fetchChecks: vi.fn(() => Promise.resolve({ issues: [], spellPending: false })),
  triggerScan: vi.fn(() => Promise.resolve({ files: 0, refs: 0, scannedAt: "" })),
  scanSummary: vi.fn(() => Promise.resolve({ indexed: false, files: 0, refs: 0 })),
  usedKeys: vi.fn(() => Promise.resolve({ indexed: false, used: [] })),
}));

import { fetchState } from "@/api.js";

const emptyState = {
  version: 1,
  config: {
    sourceLocale: "en",
    locales: ["en"],
    outputs: [],
    format: { indent: 2, sortKeys: true, finalNewline: true },
  },
  keys: {},
} as State;

// shallow: stub child components so the test exercises only EditorView's own
// loading markup, and child API imports don't need mocking. TooltipProvider wraps
// the whole view, so pass its slot through (a bare stub would swallow the body).
const mountEditor = () =>
  mount(EditorView, {
    shallow: true,
    global: { stubs: { TooltipProvider: { template: "<div><slot /></div>" } } },
  });

describe("EditorView loading spinner", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("shows a delayed spinner only while a slow initial load is in flight", async () => {
    vi.useFakeTimers();
    let resolveState!: (s: State) => void;
    vi.mocked(fetchState).mockReturnValue(new Promise<State>((r) => { resolveState = r; }));

    const w = mountEditor();
    await flushPromises();

    // Before the 250ms threshold: no spinner, and not the misleading empty state.
    expect(w.text()).not.toContain("Loading…");
    expect(w.text()).not.toContain("No keys match");

    // Past the threshold with the load still pending: the spinner appears.
    vi.advanceTimersByTime(250);
    await flushPromises();
    expect(w.text()).toContain("Loading…");

    // Load resolves: spinner gone, the real (empty) state is shown.
    resolveState(emptyState);
    await flushPromises();
    expect(w.text()).not.toContain("Loading…");
    expect(w.text()).toContain("No keys match");
  });

  it("never flashes the spinner when the initial load is fast", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchState).mockResolvedValue(emptyState);

    const w = mountEditor();
    await flushPromises();

    // Resolved well before the 250ms threshold → spinner never shown.
    expect(w.text()).not.toContain("Loading…");
    vi.advanceTimersByTime(250);
    await flushPromises();
    expect(w.text()).not.toContain("Loading…");
  });
});

const twoKeyState = {
  ...emptyState,
  config: { ...emptyState.config, locales: ["en", "fr"] },
  keys: {
    a: { values: { en: { value: "Hi", state: "source" } } },
    b: { values: { en: { value: "Bye", state: "source" } } },
  },
} as unknown as State;

describe("EditorView '/' search hotkey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("focuses the search box when '/' is pressed", async () => {
    vi.mocked(fetchState).mockResolvedValue(emptyState);
    // shallow stubs the children, but un-stub Input so a real, focusable <input> renders.
    const w = mount(EditorView, {
      attachTo: document.body,
      shallow: true,
      global: { stubs: { TooltipProvider: { template: "<div><slot /></div>" }, Input: false } },
    });
    await flushPromises();

    const search = w.get('input[placeholder^="Search…"]').element as HTMLInputElement;
    expect(document.activeElement).not.toBe(search);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    await nextTick();
    expect(document.activeElement).toBe(search);

    w.unmount();
  });
});

describe("EditorView single-locale focused facet scoping", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { location.hash = ""; multilingualLocales.value = null; });

  it("scopes the missing facet to a single focused locale (the old bilingual view)", async () => {
    // "a" is translated in fr but missing in de; "b" is the reverse.
    const threeLocaleState = {
      ...emptyState,
      config: { ...emptyState.config, locales: ["en", "fr", "de"] },
      keys: {
        a: { values: { en: { value: "Hi", state: "source" }, fr: { value: "Salut", state: "translated" } } },
        b: { values: { en: { value: "Bye", state: "source" }, de: { value: "Tschüss", state: "translated" } } },
      },
    } as unknown as State;
    vi.mocked(fetchState).mockResolvedValue(threeLocaleState);

    // Focusing the view on fr alone is now what "bilingual" used to be.
    multilingualLocales.value = ["fr"];
    location.hash = "#/?states=missing";
    const w = mountEditor();
    await flushPromises();

    // Viewing fr: only the key missing in fr should match, not keys missing
    // elsewhere (de) that are complete in the visible locale.
    await w.get('[data-testid="select-all"]').trigger("click");
    expect(w.findComponent(SelectionBar).props("keys")).toEqual(["b"]);
  });
});

describe("EditorView bulk selection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the SelectionBar with all filtered keys after select-all", async () => {
    vi.mocked(fetchState).mockResolvedValue(twoKeyState);
    const w = mountEditor();
    await flushPromises();

    expect(w.findComponent(SelectionBar).exists()).toBe(false);
    await w.get('[data-testid="select-all"]').trigger("click");
    const bar = w.findComponent(SelectionBar);
    expect(bar.exists()).toBe(true);
    expect(bar.props("keys")).toHaveLength(2);
  });

  it("keeps the selection after the Translate dialog is closed", async () => {
    vi.mocked(fetchState).mockResolvedValue(twoKeyState);
    const w = mountEditor();
    await flushPromises();

    // Select all → SelectionBar scoped to both keys.
    await w.get('[data-testid="select-all"]').trigger("click");
    expect(w.findComponent(SelectionBar).props("keys")).toHaveLength(2);

    // Open the Translate dialog from the bar, then close it (translate done / cancelled).
    w.findComponent(SelectionBar).vm.$emit("translate");
    await nextTick();
    w.findComponent(TranslateDialog).vm.$emit("update:open", false);
    await flushPromises();

    // Translate doesn't remove keys, so the selection must survive for chaining.
    expect(w.findComponent(SelectionBar).exists()).toBe(true);
    expect(w.findComponent(SelectionBar).props("keys")).toHaveLength(2);
  });
});
