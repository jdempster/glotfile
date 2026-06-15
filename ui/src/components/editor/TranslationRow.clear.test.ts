import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import TranslationRow from "./TranslationRow.vue";
import type { LocaleValue } from "@/types.js";

vi.mock("@/api.js", () => ({
  setState: vi.fn(() => Promise.resolve({})),
  translate: vi.fn(() => Promise.resolve({ requested: 0, written: 0, errors: [] })),
  clearValue: vi.fn(() => Promise.resolve({})),
}));

import { clearValue } from "@/api.js";

function mountRow(props: Record<string, unknown>) {
  return mount(TooltipProvider, {
    slots: { default: () => h(TranslationRow, props) },
  });
}

const value: LocaleValue = { value: "Accueil", state: "reviewed" };

describe("TranslationRow clear", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls clearValue with (key, locale) when the clear button is clicked", async () => {
    const w = mountRow({ keyName: "home.title", locale: "fr", sourceLocale: "en", value });

    await w.get('button[aria-label="Clear translation"]').trigger("click");
    await flushPromises();

    expect(clearValue).toHaveBeenCalledWith("home.title", "fr");
  });

  it("does not render the clear button for the source locale", () => {
    const w = mountRow({ keyName: "home.title", locale: "en", sourceLocale: "en", value });
    expect(w.find('button[aria-label="Clear translation"]').exists()).toBe(false);
  });

  it("does not render the clear button for an empty target cell", () => {
    const w = mountRow({ keyName: "home.title", locale: "fr", sourceLocale: "en", value: undefined });
    expect(w.find('button[aria-label="Clear translation"]').exists()).toBe(false);
  });
});
