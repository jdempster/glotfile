import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import AnalyticsView from "./AnalyticsView.vue";
import { pendingFilter } from "@/drilldown.js";
import type { State } from "@/types.js";

const mountView = () =>
  mount(TooltipProvider, { slots: { default: () => h(AnalyticsView) } }).findComponent(AnalyticsView);

// 60 keys, each translated in fr but missing in de — yields a 60-item worklist,
// past the 50 per-page cap, so the "Show more" reveal must kick in.
const N = 60;
const keys: State["keys"] = {};
for (let i = 0; i < N; i++) {
  keys[`k${i}`] = { values: { en: { value: `v${i}`, state: "source" }, fr: { value: `v${i}`, state: "machine" } } };
}
const state: State = {
  version: 1,
  config: { sourceLocale: "en", locales: ["en", "fr", "de"], outputs: [], format: { indent: 2, sortKeys: true, finalNewline: true } },
  keys,
};

vi.mock("@/api.js", () => ({
  fetchState: vi.fn(() => Promise.resolve(state)),
  fetchLint: vi.fn(() =>
    Promise.resolve({
      findings: Array.from({ length: N }, (_, i) => ({
        ruleId: "empty-translation",
        key: `k${i}`,
        locale: "de",
        severity: "error",
        message: "translation is empty or missing",
      })),
      counts: { error: N, warn: 0 },
      ok: false,
    }),
  ),
}));

describe("AnalyticsView pagination", () => {
  beforeEach(() => {
    pendingFilter.value = null;
    localStorage.clear();
  });

  it("caps the worklist at one page and reveals the rest on demand", async () => {
    const wrapper = mountView();
    await flushPromises();

    // 50 work-item rows + 1 row holding the "Show more" button.
    expect(wrapper.findAll("ol li")).toHaveLength(51);
    const more = wrapper.findAll("ol li button").find((b) => b.text().includes("Show"));
    expect(more).toBeTruthy();
    expect(more!.text()).toContain("Show 10 more");
    expect(more!.text()).toContain("10 hidden");

    await more!.trigger("click");
    // All 60 rows now rendered, nothing hidden, the reveal row is gone.
    expect(wrapper.findAll("ol li")).toHaveLength(60);
  });
});
