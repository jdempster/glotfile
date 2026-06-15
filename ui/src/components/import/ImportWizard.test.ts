import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import ImportWizard from "./ImportWizard.vue";

vi.mock("@/api.js", () => ({
  detectImport: vi.fn(() =>
    Promise.resolve({
      found: true,
      format: "flutter-arb",
      localeRoot: "lib/l10n",
      locales: ["en", "fr"],
      sourceLocale: "en",
      keyCount: 2,
      sampleKeys: [{ key: "k", value: "v" }],
    }),
  ),
  runImportApi: vi.fn(() => Promise.resolve({ keyCount: 2, localeCount: 2, warnings: [] })),
}));

import { runImportApi } from "@/api.js";

// The Dialog teleports its content to document.body, so query the document.
function clickImport() {
  for (const b of document.querySelectorAll<HTMLButtonElement>("button")) {
    if (b.getAttribute("data-testid") === "import-btn") b.click();
  }
}

describe("ImportWizard CLDR toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  async function mountReady() {
    // ImportWizard's tooltips need a TooltipProvider ancestor — wrap, then drill back to it.
    const wrapper = mount(TooltipProvider, { attachTo: document.body, slots: { default: () => h(ImportWizard) } });
    const w = wrapper.findComponent(ImportWizard);
    await (w.vm as unknown as { init: () => Promise<void> }).init();
    await flushPromises();
    return w;
  }

  it("imports with CLDR conversion by default", async () => {
    await mountReady();
    clickImport();
    await flushPromises();
    expect(runImportApi).toHaveBeenCalledWith(expect.objectContaining({ cldr: true }));
  });

  it("passes cldr:false when the toggle is unchecked", async () => {
    await mountReady();
    const toggle = document.querySelector('[data-testid="cldr-toggle"]') as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();
    clickImport();
    await flushPromises();
    expect(runImportApi).toHaveBeenCalledWith(expect.objectContaining({ cldr: false }));
  });
});
