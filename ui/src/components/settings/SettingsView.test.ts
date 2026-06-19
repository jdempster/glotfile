import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Config, State } from "@/types.js";

const putConfig = vi.fn((..._args: unknown[]) => Promise.resolve());
const putLocalSettings = vi.fn((..._args: unknown[]) => Promise.resolve());

function makeConfig(): Config {
  return {
    sourceLocale: "en",
    locales: ["en", "fr"],
    outputs: [],
    format: { indent: 2, sortKeys: true, finalNewline: true },
    autoExport: true,
    spelling: { customWords: [] },
  };
}

const defaultLocal = { ai: { provider: "anthropic", model: "claude-opus-4-8", endpoint: null, region: null, batchSize: 25 }, editor: "vscode" };

let mockState: State;

vi.mock("@/api.js", () => ({
  fetchState: vi.fn(() => Promise.resolve(mockState)),
  putConfig: (...args: unknown[]) => putConfig(...args),
  getLocalSettings: vi.fn(() => Promise.resolve(defaultLocal)),
  putLocalSettings: (...args: unknown[]) => putLocalSettings(...args),
  getAiProfiles: vi.fn(() => Promise.resolve({ profiles: {}, activeProfile: null })),
  putAiProfile: vi.fn(() => Promise.resolve()),
  deleteAiProfile: vi.fn(() => Promise.resolve()),
  setActiveAiProfile: vi.fn(() => Promise.resolve()),
  suggestProjectContext: vi.fn(() => Promise.resolve({ projectContext: "Sprout is a houseplant-care app." })),
  suggestLocaleInstruction: (...args: unknown[]) => suggestLocaleInstruction(...args),
}));

const suggestLocaleInstruction = vi.fn((..._args: unknown[]) => Promise.resolve({ instruction: "Use vouvoiement." }));

// Imported after the mock is declared so SettingsView and the test share one router module.
import SettingsView from "./SettingsView.vue";
import { navigate, setLeaveGuard } from "@/router";

function leaveButton(w: VueWrapper, label: string) {
  return w.findAll("button").find((b) => b.text().includes(label));
}

// LanguageLabel (one per locale chip) needs a TooltipProvider ancestor — wrap, then
// operate on the outer wrapper, which contains the whole SettingsView subtree.
function mountView(hash = "#settings") {
  location.hash = hash;
  return mount(TooltipProvider, {
    slots: { default: () => h(SettingsView) },
    attachTo: document.body,
  });
}

function sidebarTab(w: VueWrapper, title: string) {
  return w.get("nav").findAll("button").find((b) => b.text().includes(title));
}

async function mountDirty() {
  const w = mountView();
  await flushPromises();
  // Adding a language diverges the draft from the saved snapshot → one unsaved change.
  await w.get("#add-locale").setValue("de");
  await w.get("#add-locale").trigger("keydown.enter");
  return w;
}

describe("SettingsView unsaved-changes guard", () => {
  beforeEach(() => {
    mockState = { version: 1, config: makeConfig(), keys: {} };
    putConfig.mockClear();
    location.hash = "";
  });
  afterEach(() => {
    setLeaveGuard(null);
    location.hash = "";
  });

  it("blocks an in-app navigation and warns when there are unsaved changes", async () => {
    const w = await mountDirty();

    navigate("editor");
    await flushPromises();

    expect(location.hash).toBe("#settings");
    expect(w.text()).toContain("Unsaved changes");
    w.unmount();
  });

  it("lets navigation through untouched when there are no unsaved changes", async () => {
    const w = mountView();
    await flushPromises();

    navigate("editor");
    await flushPromises();

    expect(location.hash).toBe("#editor");
    expect(w.text()).not.toContain("Unsaved changes");
    w.unmount();
  });

  it("discards the draft and completes the navigation on Discard & leave", async () => {
    const w = await mountDirty();
    navigate("editor");
    await flushPromises();

    await leaveButton(w, "Discard & leave")!.trigger("click");
    await flushPromises();

    expect(location.hash).toBe("#editor");
    expect(putConfig).not.toHaveBeenCalled();
    w.unmount();
  });

  it("keeps editing (stays put, no warning) when Keep editing is chosen", async () => {
    const w = await mountDirty();
    navigate("editor");
    await flushPromises();

    await leaveButton(w, "Keep editing")!.trigger("click");
    await flushPromises();

    expect(location.hash).toBe("#settings");
    expect(w.text()).not.toContain("Unsaved changes");
    w.unmount();
  });

  it("dismisses the warning on Escape and stays put", async () => {
    const w = await mountDirty();
    navigate("editor");
    await flushPromises();
    expect(w.text()).toContain("Unsaved changes");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();

    expect(location.hash).toBe("#settings");
    expect(w.text()).not.toContain("Unsaved changes");
    w.unmount();
  });

  it("saves then navigates on Save & leave", async () => {
    const w = await mountDirty();
    navigate("editor");
    await flushPromises();

    await leaveButton(w, "Save & leave")!.trigger("click");
    await flushPromises();

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe("#editor");
    w.unmount();
  });
});

describe("SettingsView subtab history", () => {
  beforeEach(() => {
    mockState = { version: 1, config: makeConfig(), keys: {} };
    location.hash = "";
  });
  afterEach(() => {
    setLeaveGuard(null);
    location.hash = "";
  });

  it("opens the subtab named in the URL", async () => {
    const w = mountView("#settings?section=ai");
    await flushPromises();
    expect(w.text()).toContain("The provider and model used for machine translation.");
    w.unmount();
  });

  it("falls back to Languages for an unknown or missing subtab", async () => {
    const w = mountView("#settings?section=bogus");
    await flushPromises();
    expect(w.text()).toContain("The source language is translated into every other language.");
    w.unmount();
  });

  it("reflects the chosen subtab in the URL", async () => {
    const w = mountView();
    await flushPromises();

    await sidebarTab(w, "AI")!.trigger("click");
    await flushPromises();

    expect(location.hash).toContain("section=ai");
    expect(w.text()).toContain("The provider and model used for machine translation.");
    w.unmount();
  });

  it("follows the URL when browser history changes the subtab", async () => {
    const w = mountView();
    await flushPromises();

    // Simulate a back/forward landing on a different subtab.
    location.hash = "#settings?section=scan";
    window.dispatchEvent(new Event("hashchange"));
    await flushPromises();

    expect(w.text()).toContain("How the usage scanner finds where keys are referenced");
    w.unmount();
  });
});

describe("SettingsView translation guidance", () => {
  beforeEach(() => {
    mockState = { version: 1, config: makeConfig(), keys: {} };
    putConfig.mockClear();
    location.hash = "";
  });
  afterEach(() => {
    setLeaveGuard(null);
    location.hash = "";
  });

  it("shows a project-context field and a per-target-language rule field (not the source)", async () => {
    const w = mountView("#settings?section=guidance");
    await flushPromises();
    expect(w.find("#project-context").exists()).toBe(true);
    // fr is a target → has a rule field; en is the source → does not.
    expect(w.find("#locale-instruction-fr").exists()).toBe(true);
    expect(w.find("#locale-instruction-en").exists()).toBe(false);
    w.unmount();
  });

  it("saves the project context and per-locale instruction into the config", async () => {
    const w = mountView("#settings?section=guidance");
    await flushPromises();

    await w.get("#project-context").setValue("Sprout is a houseplant-care app.");
    await w.get("#locale-instruction-fr").setValue("Use vouvoiement.");
    await flushPromises();

    await w.get("[data-testid='save-config']").trigger("click");
    await flushPromises();

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenCalledWith(expect.objectContaining({
      projectContext: "Sprout is a houseplant-care app.",
      localeInstructions: { fr: "Use vouvoiement." },
    }));
    w.unmount();
  });

  it("fills the project-context field from an AI suggestion", async () => {
    const w = mountView("#settings?section=guidance");
    await flushPromises();

    await w.get("[data-testid='suggest-context']").trigger("click");
    await flushPromises();

    expect((w.get("#project-context").element as HTMLTextAreaElement).value).toBe("Sprout is a houseplant-care app.");
    w.unmount();
  });

  it("fills a locale field from an AI suggestion, passing the current project context", async () => {
    const w = mountView("#settings?section=guidance");
    await flushPromises();

    await w.get("#project-context").setValue("Sprout is a plant app.");
    await w.get("[data-testid='suggest-locale-fr']").trigger("click");
    await flushPromises();

    expect(suggestLocaleInstruction).toHaveBeenCalledWith({ locale: "fr", projectContext: "Sprout is a plant app." });
    expect((w.get("#locale-instruction-fr").element as HTMLTextAreaElement).value).toBe("Use vouvoiement.");
    w.unmount();
  });

  it("disables Suggest when no AI model is configured", async () => {
    const { getLocalSettings } = await import("@/api.js");
    vi.mocked(getLocalSettings).mockResolvedValueOnce({ ai: { ...defaultLocal.ai, model: "" }, editor: "vscode" } as never);
    const w = mountView("#settings?section=guidance");
    await flushPromises();
    expect((w.get("[data-testid='suggest-context']").element as HTMLButtonElement).disabled).toBe(true);
    w.unmount();
  });
});

describe("SettingsView local AI settings (autosave)", () => {
  // Exceeds the 500ms autosave debounce so a scheduled write actually fires.
  const past = (ms = 700) => new Promise((r) => setTimeout(r, ms));

  beforeEach(() => {
    mockState = { version: 1, config: makeConfig(), keys: {} };
    putLocalSettings.mockClear();
    location.hash = "";
  });
  afterEach(() => {
    setLeaveGuard(null);
    location.hash = "";
  });

  it("does not autosave just from opening the AI subtab (no edit)", async () => {
    const w = mountView("#settings?section=ai");
    await flushPromises();
    // Loading the local settings into the form must NOT count as an edit.
    await past();
    await flushPromises();
    expect(putLocalSettings).not.toHaveBeenCalled();
    w.unmount();
  });

  it("autosaves to .glotfile when an AI field is edited", async () => {
    const w = mountView("#settings?section=ai");
    await flushPromises();

    await w.get("#ai-model").setValue("claude-sonnet-4-6");
    await past();
    await flushPromises();

    expect(putLocalSettings).toHaveBeenCalledTimes(1);
    expect(putLocalSettings).toHaveBeenCalledWith({ ai: expect.objectContaining({ model: "claude-sonnet-4-6" }) });
    w.unmount();
  });

  it("round-trips price-per-MTok fields when another field is edited", async () => {
    const { getLocalSettings } = await import("@/api.js");
    vi.mocked(getLocalSettings).mockResolvedValueOnce({
      ai: { ...defaultLocal.ai, inputPricePerMTok: 0.4, outputPricePerMTok: 2 },
      editor: "vscode",
    } as never);

    const w = mountView("#settings?section=ai");
    await flushPromises();

    await w.get("#ai-model").setValue("claude-sonnet-4-6");
    await past();
    await flushPromises();

    // Saving must not wipe the price fields — they ride along with the draft.
    expect(putLocalSettings).toHaveBeenCalledWith({
      ai: expect.objectContaining({ inputPricePerMTok: 0.4, outputPricePerMTok: 2 }),
    });
    w.unmount();
  });
});
