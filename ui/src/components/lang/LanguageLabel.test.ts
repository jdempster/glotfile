import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import LanguageLabel from "./LanguageLabel.vue";

// LanguageLabel's tooltips need a TooltipProvider ancestor — wrap, then drill back to the label.
function mountLabel(props: Record<string, unknown>) {
  return mount(TooltipProvider, {
    slots: { default: () => h(LanguageLabel, props) },
  }).findComponent(LanguageLabel);
}

describe("LanguageLabel", () => {
  it("shows the raw code by default", () => {
    const w = mountLabel({ code: "en_US" });
    expect(w.text()).toContain("EN_US");
  });

  it("shows the resolved display name when asked", () => {
    const w = mountLabel({ code: "en", showName: true });
    expect(w.text()).toContain("English");
  });

  it("uses the name override", () => {
    const w = mountLabel({ code: "en_PIRATE", showName: true, override: { name: "Pirate English" } });
    expect(w.text()).toContain("Pirate English");
  });

  it("renders a Flag", () => {
    const w = mountLabel({ code: "en" });
    expect(w.find("img,svg").exists()).toBe(true);
  });

  it("stacked layout shows code, name, and an RTL chip for RTL locales", () => {
    const w = mountLabel({ code: "ar", showName: true, layout: "stacked" });
    expect(w.text()).toContain("AR");
    expect(w.text()).toContain("Arabic");
    expect(w.text()).toContain("RTL");
  });

  it("stacked layout omits the RTL chip for LTR locales", () => {
    const w = mountLabel({ code: "fr", showName: true, layout: "stacked" });
    expect(w.text()).toContain("FR");
    expect(w.text()).toContain("French");
    expect(w.text()).not.toContain("RTL");
  });
});
