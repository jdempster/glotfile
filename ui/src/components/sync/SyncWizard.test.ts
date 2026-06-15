import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import SyncWizard from "./SyncWizard.vue";

const emptyPlan = { added: [], sourceChanged: [], adopted: [], removed: [], unchanged: 0 };

vi.mock("@/api.js", () => ({
  syncPreview: vi.fn(),
  syncApply: vi.fn(() => Promise.resolve({ applied: true, plan: emptyPlan, warnings: [], usageRefs: 0 })),
}));

import { syncPreview, syncApply } from "@/api.js";

function click(testid: string) {
  for (const b of document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)) b.click();
}

async function mountReady() {
  const wrapper = mount(TooltipProvider, { attachTo: document.body, slots: { default: () => h(SyncWizard) } });
  const w = wrapper.findComponent(SyncWizard);
  await (w.vm as unknown as { init: () => Promise<void> }).init();
  await flushPromises();
  return w;
}

describe("SyncWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    vi.mocked(syncApply).mockResolvedValue({ applied: true, plan: emptyPlan, warnings: [], usageRefs: 0 });
  });

  it("applies with prune:false by default", async () => {
    vi.mocked(syncPreview).mockResolvedValue({
      plan: { ...emptyPlan, added: ["a"], removed: ["b"], unchanged: 3 },
      warnings: [],
    });
    await mountReady();
    click("apply-btn");
    await flushPromises();
    expect(syncApply).toHaveBeenCalledWith({ prune: false });
  });

  it("passes prune:true when the toggle is on", async () => {
    vi.mocked(syncPreview).mockResolvedValue({
      plan: { ...emptyPlan, removed: ["b", "c"], unchanged: 1 },
      warnings: [],
    });
    await mountReady();
    click("prune-toggle");
    await flushPromises();
    click("apply-btn");
    await flushPromises();
    expect(syncApply).toHaveBeenCalledWith({ prune: true });
  });

  it("shows the in-sync state and no apply button when nothing changed", async () => {
    vi.mocked(syncPreview).mockResolvedValue({ plan: { ...emptyPlan, unchanged: 10 }, warnings: [] });
    await mountReady();
    expect(document.querySelector('[data-testid="apply-btn"]')).toBeNull();
    expect(document.body.textContent).toContain("Already in sync");
  });

  it("hides the prune toggle when there are no removed keys", async () => {
    vi.mocked(syncPreview).mockResolvedValue({ plan: { ...emptyPlan, added: ["a"] }, warnings: [] });
    await mountReady();
    expect(document.querySelector('[data-testid="prune-toggle"]')).toBeNull();
  });
});
