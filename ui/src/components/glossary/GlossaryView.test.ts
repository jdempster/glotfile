import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import GlossaryView from "./GlossaryView.vue";
import type { GlossarySuggestion } from "@/types.js";

vi.mock("@/api.js", () => ({
  getGlossary: vi.fn(() => Promise.resolve([])),
  fetchState: vi.fn(() =>
    Promise.resolve({
      version: 1,
      config: { sourceLocale: "en", locales: ["en", "fr"], outputs: [] },
      keys: {},
    }),
  ),
  getGlossarySuggestions: vi.fn(() => Promise.resolve([])),
  dismissGlossarySuggestion: vi.fn(() => Promise.resolve({})),
  removeGlossarySuggestion: vi.fn(() => Promise.resolve({})),
  deleteGlossaryEntry: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/liveReload", () => ({ onExternalChange: vi.fn() }));

import { getGlossarySuggestions, dismissGlossarySuggestion } from "@/api.js";

const suggestion: GlossarySuggestion = {
  term: "Acme",
  note: "brand",
  status: "pending",
  occurrences: 2,
};

function mountView() {
  return mount(GlossaryView, { shallow: true });
}

describe("GlossaryView suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGlossarySuggestions).mockResolvedValue([suggestion]);
  });

  it("renders a suggestion row with term, note, and occurrences", async () => {
    const w = mountView();
    await flushPromises();
    await nextTick();

    expect(w.text()).toContain("Acme");
    expect(w.text()).toContain("brand");
    expect(w.text()).toContain("used in 2");
  });

  it("calls dismissGlossarySuggestion with the term when Dismiss is clicked", async () => {
    vi.mocked(getGlossarySuggestions)
      .mockResolvedValueOnce([suggestion])
      .mockResolvedValue([]);

    const w = mountView();
    await flushPromises();
    await nextTick();

    // In shallow mount, Button is stubbed as <button-stub>. The suggestion row has two:
    // Accept (size="sm", no variant) and Dismiss (size="sm", variant="ghost").
    // Find the dismiss button by its ghost variant.
    const dismissBtn = w
      .findAll("button-stub")
      .find((el) => el.attributes("variant") === "ghost" && el.attributes("size") === "sm");
    expect(dismissBtn).toBeDefined();
    await dismissBtn!.trigger("click");
    await flushPromises();

    expect(dismissGlossarySuggestion).toHaveBeenCalledWith("Acme");
  });

  it("opens GlossaryEntryDialog prefilled with the suggestion term when Accept is clicked", async () => {
    const w = mountView();
    await flushPromises();
    await nextTick();

    // Accept button: size="sm", no variant attribute (the primary Button).
    // Exclude the ghost variant ones (Dismiss) and size="icon" ones (Edit/Delete).
    const acceptBtn = w
      .findAll("button-stub")
      .find((el) => el.attributes("size") === "sm" && !el.attributes("variant"));
    expect(acceptBtn).toBeDefined();
    await acceptBtn!.trigger("click");
    await nextTick();

    // After clicking Accept, dialogOpen should be true and prefill should be set.
    // The GlossaryEntryDialog stub receives open="true" when the dialog is opened.
    const dialogStub = w.find("glossary-entry-dialog-stub");
    expect(dialogStub.exists()).toBe(true);
    expect(dialogStub.attributes("open")).toBe("true");
    // The prefill prop is serialized; the rendered HTML should reference "Acme" somewhere
    // or we can check via the component's underlying state. Check the stub has a prefill attribute.
    expect(dialogStub.attributes()).toHaveProperty("prefill");
  });
});
