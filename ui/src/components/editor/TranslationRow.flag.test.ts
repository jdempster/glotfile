import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import TranslationRow from "./TranslationRow.vue";
import type { LocaleValue } from "@/types.js";

vi.mock("@/api.js", () => ({
  setState: vi.fn(() => Promise.resolve({})),
  translate: vi.fn(() => Promise.resolve({ requested: 0, written: 0, errors: [] })),
  clearValue: vi.fn(() => Promise.resolve({})),
}));

function mountRow(props: Record<string, unknown>) {
  return mount(TooltipProvider, { slots: { default: () => h(TranslationRow, props) } });
}

const value: LocaleValue = { value: "Accueil", state: "reviewed" };

describe("TranslationRow flag label", () => {
  it("renders a flag image for the locale", () => {
    const w = mountRow({ keyName: "home.title", locale: "en", sourceLocale: "en", value });
    expect(w.find("img").exists()).toBe(true);
  });

  it("still shows the locale code", () => {
    const w = mountRow({ keyName: "home.title", locale: "fr", sourceLocale: "en", value });
    expect(w.text()).toContain("FR");
  });
});
