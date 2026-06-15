import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
// virtual:docs-bundle is aliased to docs-bundle.fixture.ts in vitest.config.ts.
import DocsView from "./DocsView.vue";

function navLabels(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll("nav button").map((b) => b.text().trim());
}

describe("DocsView", () => {
  beforeEach(() => {
    location.hash = "";
  });

  it("renders the Frameworks section that SECTION_ORDER lists", () => {
    const wrapper = mount(DocsView);
    expect(wrapper.text()).toContain("Frameworks");
    expect(navLabels(wrapper)).toEqual(expect.arrayContaining(["Angular", "Laravel"]));
  });

  it("renders sections not present in SECTION_ORDER so new dirs never vanish", () => {
    const wrapper = mount(DocsView);
    expect(wrapper.text()).toContain("Bonus");
    expect(navLabels(wrapper)).toContain("Extra");
  });

  it("pushes the selected doc into the url hash", async () => {
    const wrapper = mount(DocsView);
    const angular = wrapper.findAll("nav button").find((b) => b.text().trim() === "Angular")!;
    await angular.trigger("click");
    expect(location.hash).toBe("#docs?doc=frameworks%2Fangular");
    expect(wrapper.find(".prose").html()).toContain("angular body");
  });

  it("opens the deep-linked doc from the url on mount", () => {
    location.hash = "#docs?doc=frameworks%2Flaravel";
    const wrapper = mount(DocsView);
    expect(wrapper.find(".prose").html()).toContain("laravel body");
  });

  it("restores the doc on hashchange (back/forward traversal)", async () => {
    const wrapper = mount(DocsView);
    expect(wrapper.find(".prose").html()).toContain("home body");

    location.hash = "#docs?doc=frameworks%2Fangular";
    window.dispatchEvent(new Event("hashchange"));
    await nextTick();
    expect(wrapper.find(".prose").html()).toContain("angular body");
  });
});
