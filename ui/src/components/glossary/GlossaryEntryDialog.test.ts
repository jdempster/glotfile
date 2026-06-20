import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import GlossaryEntryDialog from "./GlossaryEntryDialog.vue";
import type { GlossaryEntry } from "@/types.js";

// GlossaryEntryDialog renders LanguageLabel (tooltips), which needs a TooltipProvider ancestor.
function mountDialog(props: Record<string, unknown>) {
  return mount(TooltipProvider, {
    slots: { default: () => h(GlossaryEntryDialog, props) },
  }).findComponent(GlossaryEntryDialog);
}

vi.mock("@/api.js", () => ({
  putGlossaryEntry: vi.fn(() => Promise.resolve({})),
}));

import { putGlossaryEntry } from "@/api.js";

// The Dialog content is teleported via reka-ui's portal, so it lands in document.body
// (outside the wrapper) and only after a tick. Target fields by their stable ids.
function byId(id: string) {
  return new DOMWrapper(document.getElementById(id) as HTMLElement);
}
function buttonByText(text: string) {
  const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  return new DOMWrapper(el!);
}

describe("GlossaryEntryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders the pre-filled entry when editing", async () => {
    const entry: GlossaryEntry = { term: "feed", notes: "fertilize", translations: { fr: "nourrir" } };
    mountDialog({ open: true, entry, targetLocales: ["fr", "de"] });
    await nextTick();

    const termInput = byId("glossary-term").element as HTMLInputElement;
    expect(termInput.value).toBe("feed");
    expect(termInput.disabled).toBe(true);
    expect(document.body.textContent).toContain("Edit term");
    // The pinned fr translation renders as an editable row; unpinned de does not.
    expect((byId("glossary-tr-fr").element as HTMLInputElement).value).toBe("nourrir");
    expect(document.getElementById("glossary-tr-de")).toBeNull();
  });

  it("adds aliases (enter- and comma-committed) and saves them", async () => {
    const w = mountDialog({ open: true, entry: null, targetLocales: ["fr"] });
    await nextTick();

    await byId("glossary-term").setValue("feed");
    const alias = byId("glossary-aliases");
    await alias.setValue("feeding");
    await alias.trigger("keydown.enter");
    await alias.setValue("feeds, fed");
    await alias.trigger("blur");

    await buttonByText("Add term").trigger("click");
    await flushPromises();

    expect(putGlossaryEntry).toHaveBeenCalledTimes(1);
    expect(putGlossaryEntry).toHaveBeenCalledWith({ term: "feed", aliases: ["feeding", "feeds", "fed"] });
    expect(w.emitted("saved")).toBeTruthy();
  });

  it("saves edited pinned translations and omits the empty ones", async () => {
    mountDialog({ open: true, entry: { term: "feed", translations: { fr: "x", de: "y" } }, targetLocales: ["fr", "de"] });
    await nextTick();

    await byId("glossary-tr-fr").setValue("nourrir");
    await byId("glossary-tr-de").setValue("");

    await buttonByText("Save").trigger("click");
    await flushPromises();

    expect(putGlossaryEntry).toHaveBeenCalledWith({ term: "feed", translations: { fr: "nourrir" } });
  });

  it("preserves the case-sensitive flag through an edit", async () => {
    mountDialog({ open: true, entry: { term: "Sprout", doNotTranslate: true, caseSensitive: true }, targetLocales: ["fr"] });
    await nextTick();

    await buttonByText("Save").trigger("click");
    await flushPromises();

    expect(putGlossaryEntry).toHaveBeenCalledWith({ term: "Sprout", doNotTranslate: true, caseSensitive: true });
  });

  it("sets case-sensitive when the toggle is enabled for a new term", async () => {
    mountDialog({ open: true, entry: null, targetLocales: ["fr"] });
    await nextTick();

    await byId("glossary-term").setValue("Sprout");
    await byId("glossary-case-sensitive").trigger("click");

    await buttonByText("Add term").trigger("click");
    await flushPromises();

    expect(putGlossaryEntry).toHaveBeenCalledWith({ term: "Sprout", caseSensitive: true });
  });

  it("hides and omits pinned translations for a do-not-translate term", async () => {
    mountDialog({ open: true, entry: { term: "Sprout", doNotTranslate: true, translations: { fr: "x" } }, targetLocales: ["fr"] });
    await nextTick();

    // The pinned-translations section is hidden when do-not-translate is on.
    expect(document.getElementById("glossary-tr-fr")).toBeNull();

    await buttonByText("Save").trigger("click");
    await flushPromises();

    expect(putGlossaryEntry).toHaveBeenCalledWith({ term: "Sprout", doNotTranslate: true });
  });
});
