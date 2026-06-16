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

const entry: GlossaryEntry = {
  term: "Sign in",
  doNotTranslate: true,
  notes: "Auth CTA",
  translations: { fr: "Se connecter" },
};

// The Dialog content is teleported via reka-ui's portal, so it lands in document.body
// (outside the wrapper) and only after a tick.
function inputs() {
  return Array.from(document.querySelectorAll("input")).map((el) => new DOMWrapper(el));
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
    mountDialog({ open: true, entry, targetLocales: ["fr", "de"] });
    await nextTick();

    const termInput = inputs()[0]!.element as HTMLInputElement;
    expect(termInput.value).toBe("Sign in");
    expect(termInput.disabled).toBe(true);
    expect(document.body.textContent).toContain("Edit term");
  });

  it("saves only non-empty translations and omits false flags", async () => {
    const w = mountDialog({ open: true, entry: null, targetLocales: ["fr", "de"] });
    await nextTick();

    const fields = inputs();
    // fields[0] = term, fields[1] = fr forced translation, fields[2] = de forced translation.
    await fields[0]!.setValue("Logout");
    await fields[1]!.setValue("Se déconnecter");
    await fields[2]!.setValue("");

    await buttonByText("Add term").trigger("click");
    await flushPromises();

    expect(putGlossaryEntry).toHaveBeenCalledTimes(1);
    expect(putGlossaryEntry).toHaveBeenCalledWith({
      term: "Logout",
      translations: { fr: "Se déconnecter" },
    });
    expect(w.emitted("saved")).toBeTruthy();
  });

  it("preserves the wholeWord opt-out (false) when editing", async () => {
    const wwEntry: GlossaryEntry = { term: "Pro", wholeWord: false };
    mountDialog({ open: true, entry: wwEntry, targetLocales: [] });
    await nextTick();

    await buttonByText("Save").trigger("click");
    await flushPromises();

    expect(putGlossaryEntry).toHaveBeenCalledWith({ term: "Pro", wholeWord: false });
  });
});
