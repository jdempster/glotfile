import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AnalyticsView from "./AnalyticsView.vue";
import { pendingFilter } from "@/drilldown.js";
import type { State } from "@/types.js";

// en → fr, de. fr fully translated but with a breaking placeholder; de missing one string.
const state: State = {
  version: 1,
  config: {
    sourceLocale: "en",
    locales: ["en", "fr", "de"],
    outputs: [],
    format: { indent: 2, sortKeys: true, finalNewline: true },
  },
  keys: {
    "app.title": { values: { en: { value: "Glotfile", state: "source" }, fr: { value: "Glotfile", state: "machine" }, de: { value: "Glotfile", state: "machine" } } },
    "home.welcome": { values: { en: { value: "Welcome {name}", state: "source" }, fr: { value: "Bienvenue {name}", state: "machine" } } },
    "checkout.pay": { values: { en: { value: "Pay {amount}", state: "source" }, fr: { value: "Payer", state: "machine" }, de: { value: "Bezahlen", state: "machine" } } },
  },
};

// The /lint report `glotfile check` would produce for that state.
vi.mock("@/api.js", () => ({
  fetchState: vi.fn(() => Promise.resolve(state)),
  fetchLint: vi.fn(() =>
    Promise.resolve({
      findings: [
        { ruleId: "placeholder-mismatch", key: "checkout.pay", locale: "fr", severity: "error", message: "placeholders differ from the source" },
        { ruleId: "empty-translation", key: "home.welcome", locale: "de", severity: "error", message: "translation is empty or missing" },
      ],
      counts: { error: 2, warn: 0 },
      ok: false,
    }),
  ),
}));

describe("AnalyticsView", () => {
  beforeEach(() => {
    pendingFilter.value = null;
    localStorage.clear();
  });

  it("renders the readiness cockpit with a card per target locale", async () => {
    const wrapper = mount(AnalyticsView);
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Can I ship?");
    expect(text).toContain("Release readiness");
    expect(text).toContain("Needs attention");
    expect(wrapper.find('[data-test="rcard-fr"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rcard-de"]').exists()).toBe(true);
  });

  it("drills to all issues when the open-issues stat is clicked", async () => {
    const wrapper = mount(AnalyticsView);
    await flushPromises();
    await wrapper.get('[data-test="open-issues"]').trigger("click");
    expect(pendingFilter.value).toEqual({ needsAttention: true });
  });

  it("drills a blocked locale into its breaking issues", async () => {
    const wrapper = mount(AnalyticsView);
    await flushPromises();
    await wrapper.get('[data-test="rcard-fr"]').trigger("click");
    expect(pendingFilter.value).toEqual({ locale: "fr", issues: ["placeholder"] });
  });

  it("drills a locale with a missing string into its missing strings", async () => {
    const wrapper = mount(AnalyticsView);
    await flushPromises();
    await wrapper.get('[data-test="rcard-de"]').trigger("click");
    expect(pendingFilter.value).toEqual({ locale: "de", states: ["missing"] });
  });
});
