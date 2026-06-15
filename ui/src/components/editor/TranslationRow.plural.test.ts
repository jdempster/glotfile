import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import TranslationRow from "./TranslationRow.vue";
import PluralValueEditor from "./PluralValueEditor.vue";
import ValueEditor from "./ValueEditor.vue";
import type { LocaleValue } from "@/types.js";

vi.mock("@/api.js", () => ({
  setState: vi.fn(() => Promise.resolve({})),
  translate: vi.fn(() => Promise.resolve({ requested: 0, written: 0, errors: [] })),
  clearValue: vi.fn(() => Promise.resolve({})),
  setPluralForms: vi.fn(() => Promise.resolve({})),
}));

import { clearValue } from "@/api.js";

function mountRow(props: Record<string, unknown>) {
  return mount(TooltipProvider, { slots: { default: () => h(TranslationRow, props) } });
}

const pluralValue: LocaleValue = { forms: { one: "{count} item", other: "{count} items" }, state: "source" };

describe("TranslationRow plural", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders PluralValueEditor (not ValueEditor) for a plural key", () => {
    const w = mountRow({
      keyName: "cart.items",
      locale: "en",
      sourceLocale: "en",
      value: pluralValue,
      plural: { arg: "count" },
    });
    expect(w.findComponent(PluralValueEditor).exists()).toBe(true);
    expect(w.findComponent(ValueEditor).exists()).toBe(false);
  });

  it("renders ValueEditor for a scalar key", () => {
    const w = mountRow({
      keyName: "home.title",
      locale: "en",
      sourceLocale: "en",
      value: { value: "Home", state: "source" },
    });
    expect(w.findComponent(ValueEditor).exists()).toBe(true);
    expect(w.findComponent(PluralValueEditor).exists()).toBe(false);
  });

  it("clears a plural target cell that has forms via clearValue", async () => {
    const w = mountRow({
      keyName: "cart.items",
      locale: "fr",
      sourceLocale: "en",
      value: { forms: { one: "{count} article", other: "{count} articles" }, state: "reviewed" },
      plural: { arg: "count" },
    });
    await w.get('button[aria-label="Clear translation"]').trigger("click");
    await flushPromises();
    expect(clearValue).toHaveBeenCalledWith("cart.items", "fr");
  });
});
