import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FilterMenu from "./FilterMenu.vue";
import { ALL_CHECKS } from "@/checks.js";

const props = (over = {}) => ({ states: [], issues: [], enabled: [...ALL_CHECKS], plurality: [], emptySource: false, aiContextUnreviewed: false, noUsages: false, skipTranslate: false, scanIndexed: true, ...over });

describe("FilterMenu", () => {
  it("offers the 'missing' state facet (the target of analytics drill-downs)", () => {
    const wrapper = mount(FilterMenu, { props: props() });
    expect(wrapper.text()).toContain("Missing");
  });

  it("reflects an active 'missing' filter as a checked status box", () => {
    const wrapper = mount(FilterMenu, { props: props({ states: ["missing"] }) });
    const checked = wrapper
      .findAll('[role="checkbox"]')
      .find((b) => b.text().includes("Missing"));
    expect(checked?.attributes("aria-checked")).toBe("true");
  });

  it("offers Plural and Single type facets", () => {
    const wrapper = mount(FilterMenu, { props: props() });
    expect(wrapper.text()).toContain("Plural");
    expect(wrapper.text()).toContain("Single");
  });

  it("emits update:plurality when a type facet is toggled", async () => {
    const wrapper = mount(FilterMenu, { props: props() });
    const plural = wrapper.findAll('[role="checkbox"]').find((b) => b.text().trim() === "Plural");
    await plural!.trigger("click");
    expect(wrapper.emitted("update:plurality")?.[0]).toEqual([["plural"]]);
  });

  it("offers an Empty source toggle and reflects its active state", () => {
    const wrapper = mount(FilterMenu, { props: props({ emptySource: true }) });
    const box = wrapper.findAll('[role="checkbox"]').find((b) => b.text().includes("Empty source"));
    expect(box?.attributes("aria-checked")).toBe("true");
  });

  it("emits update:emptySource when toggled", async () => {
    const wrapper = mount(FilterMenu, { props: props() });
    const box = wrapper.findAll('[role="checkbox"]').find((b) => b.text().includes("Empty source"));
    await box!.trigger("click");
    expect(wrapper.emitted("update:emptySource")?.[0]).toEqual([true]);
  });

  it("offers an Unused toggle, enabled when a scan index exists", () => {
    const wrapper = mount(FilterMenu, { props: props({ scanIndexed: true }) });
    const box = wrapper.findAll('[role="checkbox"]').find((b) => b.text().trim() === "Unused");
    expect(box).toBeTruthy();
    expect((box!.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("emits update:noUsages when the Unused toggle is clicked", async () => {
    const wrapper = mount(FilterMenu, { props: props({ scanIndexed: true }) });
    const box = wrapper.findAll('[role="checkbox"]').find((b) => b.text().trim() === "Unused");
    await box!.trigger("click");
    expect(wrapper.emitted("update:noUsages")?.[0]).toEqual([true]);
  });

  it("offers a Skip-translate toggle and reflects its active state", () => {
    const wrapper = mount(FilterMenu, { props: props({ skipTranslate: true }) });
    const box = wrapper.findAll('[role="checkbox"]').find((b) => b.text().includes("Skip-translate"));
    expect(box?.attributes("aria-checked")).toBe("true");
  });

  it("emits update:skipTranslate when toggled", async () => {
    const wrapper = mount(FilterMenu, { props: props() });
    const box = wrapper.findAll('[role="checkbox"]').find((b) => b.text().includes("Skip-translate"));
    await box!.trigger("click");
    expect(wrapper.emitted("update:skipTranslate")?.[0]).toEqual([true]);
  });

  it("disables the Unused toggle and shows a hint when no scan index exists", () => {
    const wrapper = mount(FilterMenu, { props: props({ scanIndexed: false }) });
    const box = wrapper.findAll('[role="checkbox"]').find((b) => b.text().trim() === "Unused");
    expect((box!.element as HTMLButtonElement).disabled).toBe(true);
    expect(wrapper.text()).toContain("Run a scan first");
  });
});
