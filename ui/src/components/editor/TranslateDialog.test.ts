import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import { h, reactive, nextTick } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import TranslateDialog from "./TranslateDialog.vue";
import type { State, TranslateStart, TranslateLocaleStart, TranslateProgress, TranslateLocaleDone, TranslateDone, TranslateEstimate } from "@/types.js";

// TranslateDialog renders LanguageLabel (tooltips), which needs a TooltipProvider ancestor.
// Returns the reactive props so tests can mutate them in place (re-render on nextTick).
function mountDialog(props: Record<string, unknown>) {
  const p = reactive({ ...props });
  mount(TooltipProvider, { slots: { default: () => h(TranslateDialog, { ...p }) } });
  return p;
}

// translateStream is an async generator yielding start/locale-start/progress/locale-done/done.
vi.mock("@/api.js", () => ({
  translateStream: vi.fn(async function* (_signal: AbortSignal) {
    yield { type: "start", total: 2, locales: [{ locale: "fr", total: 1 }, { locale: "de", total: 1 }] } as TranslateStart;
    yield { type: "locale-start", locale: "fr" } as TranslateLocaleStart;
    yield { type: "progress", done: 1, total: 2, written: 1, errors: [], locale: "fr", localeDone: 1, localeTotal: 1 } as TranslateProgress;
    yield { type: "locale-done", locale: "fr" } as TranslateLocaleDone;
    yield { type: "locale-start", locale: "de" } as TranslateLocaleStart;
    yield { type: "progress", done: 2, total: 2, written: 1, errors: [], locale: "de", localeDone: 1, localeTotal: 1 } as TranslateProgress;
    yield { type: "locale-done", locale: "de" } as TranslateLocaleDone;
    yield { type: "done", written: 1, errors: [{ key: "k", locale: "fr", error: "Placeholder mismatch" }] } as TranslateDone;
  }),
  translateEstimate: vi.fn(async () => ({
    requests: 2,
    batches: 2,
    perLocale: [
      { locale: "fr", requests: 1, batches: 1, inputTokens: 500, outputTokens: 200 },
      { locale: "de", requests: 1, batches: 1, inputTokens: 500, outputTokens: 200 },
    ],
    inputTokens: 1000,
    outputTokens: 400,
    pricing: { source: "builtin", inputPerMTok: 1, outputPerMTok: 5 },
    estimatedCost: 0.003,
  } as TranslateEstimate)),
  // Default: batch unsupported. Tests that need the button override per-case.
  batchStatus: vi.fn(async () => ({ supported: false, pending: null })),
  batchSubmit: vi.fn(async () => ({ batchId: "b1", total: 2 })),
}));

import { translateStream, translateEstimate, batchStatus, batchSubmit } from "@/api.js";

// en is source; fr + de are targets. k1 is missing both targets (2 missing pairs).
const state: State = {
  version: 1,
  config: {
    sourceLocale: "en",
    locales: ["en", "fr", "de"],
    outputs: [],
    format: { indent: 2, sortKeys: true, finalNewline: true },
  },
  keys: {
    k1: {
      values: {
        en: { value: "Hello", state: "source" },
      },
    },
  },
};

function buttonByText(text: string) {
  const el = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  return new DOMWrapper(el!);
}

describe("TranslateDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("shows the missing count, runs translateStream, shows progress bar, and renders per-string errors", async () => {
    mountDialog({ open: true, state });
    await nextTick();

    const text = document.body.textContent ?? "";
    // 2 missing pairs (fr + de for k1) across 2 languages.
    expect(text).toContain("Translate 2 missing strings");
    expect(text).toContain("across 2 languages");

    await buttonByText("Translate").trigger("click");
    await flushPromises();
    await nextTick();

    expect(translateStream).toHaveBeenCalled();

    // Progress bar should be rendered.
    const after = document.body.textContent ?? "";
    expect(after).toMatch(/1\s*\/\s*2|2\s*\/\s*2/);

    // The returned error is surfaced in the dialog, not just a toast.
    expect(after).toContain("k @");
    expect(after).toContain("Placeholder mismatch");
  });

  it("renders per-language rows with live status: one active+advanced, one still queued", async () => {
    // Hold the stream after fr has progressed but before de starts, so we can
    // observe the mid-run state: fr active (1/1), de still queued (0/1).
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(translateStream).mockImplementation(async function* () {
      yield { type: "start", total: 2, locales: [{ locale: "fr", total: 1 }, { locale: "de", total: 1 }] } as TranslateStart;
      yield { type: "locale-start", locale: "fr" } as TranslateLocaleStart;
      yield { type: "progress", done: 1, total: 2, written: 1, errors: [], locale: "fr", localeDone: 1, localeTotal: 1 } as TranslateProgress;
      await gate;
      yield { type: "locale-done", locale: "fr" } as TranslateLocaleDone;
      yield { type: "done", written: 1, errors: [] } as TranslateDone;
    });

    mountDialog({ open: true, state });
    await nextTick();
    await buttonByText("Translate").trigger("click");
    await flushPromises();
    await nextTick();

    const mid = document.body.textContent ?? "";
    // fr is active, de is still queued → 1 of 2 active.
    expect(mid).toContain("1 of 2 languages active");
    // Both languages are listed (codes always render).
    expect(mid).toContain("FR");
    expect(mid).toContain("DE");
    // fr has advanced to 1/1; de hasn't started (0/1).
    expect(mid).toContain("1 / 1");
    expect(mid).toContain("0 / 1");

    release();
    await flushPromises();
    await nextTick();
  });

  it("shows a Cancel button while running and aborts the stream when clicked", async () => {
    let aborted = false;
    vi.mocked(translateStream).mockImplementation(async function* (signal: AbortSignal) {
      await new Promise<void>((resolve) => { signal.addEventListener("abort", () => resolve()); });
      aborted = true;
    });

    mountDialog({ open: true, state });
    await nextTick();

    await buttonByText("Translate").trigger("click");
    await nextTick();

    const cancelBtn = buttonByText("Cancel");
    expect(cancelBtn.exists()).toBe(true);

    await cancelBtn.trigger("click");
    await flushPromises();
    await nextTick();

    expect(aborted).toBe(true);
    expect(buttonByText("Translate").exists()).toBe(true);
  });

  it("shows the cost estimate line when the dialog opens", async () => {
    mountDialog({ open: true, state });
    await nextTick();
    await flushPromises();
    await nextTick();

    expect(translateEstimate).toHaveBeenCalled();
    const text = document.body.textContent ?? "";
    expect(text).toContain("2 requests");
    expect(text).toContain("~1,000 in");
    expect(text).toContain("$0.0030");
  });

  it("shows a pricing hint instead of dollars when pricing is unknown", async () => {
    vi.mocked(translateEstimate).mockResolvedValueOnce({
      requests: 2,
      batches: 1,
      perLocale: [{ locale: "fr", requests: 2, batches: 1, inputTokens: 1000, outputTokens: 400 }],
      inputTokens: 1000,
      outputTokens: 400,
      pricing: null,
      estimatedCost: null,
    });
    mountDialog({ open: true, state });
    await nextTick();
    await flushPromises();
    await nextTick();

    const text = document.body.textContent ?? "";
    expect(text).toContain("set a price in Settings");
    expect(text).not.toContain("±20%");
  });

  it("shows the empty state when nothing is missing", async () => {
    const filled: State = {
      ...state,
      keys: {
        k1: {
          values: {
            en: { value: "Hello", state: "source" },
            fr: { value: "Bonjour", state: "machine" },
            de: { value: "Hallo", state: "machine" },
          },
        },
      },
    };
    mountDialog({ open: true, state: filled });
    await nextTick();

    expect(document.body.textContent).toContain("Nothing missing");
  });

  it("freezes the prompt count at run start so it doesn't tick down as state refreshes", async () => {
    const props = mountDialog({ open: true, state });
    await nextTick();
    expect(document.body.textContent).toContain("Translate 2 missing strings");

    await buttonByText("Translate").trigger("click");
    await flushPromises();
    await nextTick();

    // The run emits "changed"; the parent refreshes state. Simulate that refresh
    // landing a fully-translated state while the dialog is still open (errors keep
    // it open). The prompt must stay frozen at the run-start count, not flip to
    // the empty state.
    const filled: State = {
      ...state,
      keys: {
        k1: {
          values: {
            en: { value: "Hello", state: "source" },
            fr: { value: "Bonjour", state: "machine" },
            de: { value: "Hallo", state: "machine" },
          },
        },
      },
    };
    props.state = filled;
    await nextTick();

    expect(document.body.textContent).toContain("Translate 2 missing strings");
    expect(document.body.textContent).not.toContain("Nothing missing");
  });

  it("scopes missing count and translateStream to filteredKeys when provided", async () => {
    const stateWithExtra: State = {
      ...state,
      keys: {
        ...state.keys,
        k2: { values: { en: { value: "World", state: "source" } } },
      },
    };
    // Only k1 is in the filtered view.
    mountDialog({ open: true, state: stateWithExtra, filteredKeys: ["k1"] });
    await nextTick();

    // k2 is excluded by filteredKeys → still 2 missing (fr + de for k1 only).
    expect(document.body.textContent).toContain("Translate 2 missing strings");

    await buttonByText("Translate").trigger("click");
    await flushPromises();

    expect(translateStream).toHaveBeenCalledWith(
      expect.any(AbortSignal),
      ["k1"],
    );
  });

  it("shows the batch button when the provider supports batches and none is pending", async () => {
    vi.mocked(batchStatus).mockResolvedValueOnce({ supported: true, pending: null });
    mountDialog({ open: true, state });
    await nextTick();
    await flushPromises();
    await nextTick();

    // Mocked estimate costs $0.003 → the batch button shows the halved figure.
    const batchBtn = buttonByText("Batch ≈ $0.0015 (50% off)");
    expect(batchBtn.exists()).toBe(true);
  });

  it("submits a batch with the dialog's scope and closes", async () => {
    vi.mocked(batchStatus).mockResolvedValueOnce({ supported: true, pending: null });
    const wrapper = mount(TooltipProvider, {
      slots: { default: () => h(TranslateDialog, { open: true, state, filteredKeys: ["k1"], targetLocale: "fr", "onUpdate:open": vi.fn() }) },
    });
    await nextTick();
    await flushPromises();
    await nextTick();

    // Find the batch button by text pattern.
    const batchBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => /batch/i.test(b.textContent ?? ""),
    );
    expect(batchBtn).toBeTruthy();
    await new DOMWrapper(batchBtn!).trigger("click");
    await flushPromises();
    await nextTick();

    expect(batchSubmit).toHaveBeenCalledWith({ keys: ["k1"], locales: ["fr"] });
    // "changed" must not be emitted on the batch path — nothing written yet.
    expect(wrapper.emitted("changed")).toBeFalsy();
  });

  it("hides the batch button when unsupported", async () => {
    // Default mock already returns supported: false, but be explicit.
    vi.mocked(batchStatus).mockResolvedValueOnce({ supported: false, pending: null });
    mountDialog({ open: true, state });
    await nextTick();
    await flushPromises();
    await nextTick();

    const text = document.body.textContent ?? "";
    // The batch button (either label form) must not appear.
    expect(text).not.toMatch(/batch (≈|\(50% off\))/i);
  });
});
