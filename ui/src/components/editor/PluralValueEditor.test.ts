import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import PluralValueEditor from "./PluralValueEditor.vue";

vi.mock("@/api.js", () => ({
  setPluralForms: vi.fn(() => Promise.resolve({})),
}));

import { setPluralForms } from "@/api.js";

describe("PluralValueEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders one field per category for the locale (en → one, other)", () => {
    const w = mount(PluralValueEditor, {
      props: {
        keyName: "cart.items",
        locale: "en",
        sourceLocale: "en",
        arg: "count",
        forms: { one: "{count} item", other: "{count} items" },
      },
    });
    const fields = w.findAll("[data-testid='plural-field']");
    expect(fields).toHaveLength(2);
    expect(w.text()).toContain("one");
    expect(w.text()).toContain("other");
  });

  it("renders four fields for a Polish target", () => {
    const w = mount(PluralValueEditor, {
      props: {
        keyName: "cart.items",
        locale: "pl",
        sourceLocale: "en",
        arg: "count",
        forms: { other: "x" },
        sourceForms: { one: "{count} item", other: "{count} items" },
      },
    });
    const fields = w.findAll("[data-testid='plural-field']");
    expect(fields).toHaveLength(4);
  });

  it("shows no source reference on the source locale", () => {
    const w = mount(PluralValueEditor, {
      props: { keyName: "cart.items", locale: "en", sourceLocale: "en", arg: "count", forms: { other: "x" } },
    });
    expect(w.findAll("[data-testid='source-ref']")).toHaveLength(0);
  });

  it("shows a muted Empty marker for an empty target category, not a dash", () => {
    const w = mount(PluralValueEditor, {
      props: {
        keyName: "cart.items", locale: "pl", sourceLocale: "en", arg: "count",
        forms: { other: "Masz {count} plików" },
        sourceForms: { other: "You have {count} files" },
      },
    });
    // canonical order one, few, many, other → the first field ('one') is empty here
    const oneField = w.findAll("[data-testid='plural-field']")[0]!;
    expect(oneField.text()).toContain("Empty");
    expect(oneField.text()).not.toContain("—");
  });

  it("renders an exact (=N) selector row before the locale's categories", () => {
    const w = mount(PluralValueEditor, {
      props: {
        keyName: "deliveries.failed",
        locale: "en",
        sourceLocale: "en",
        arg: "count",
        forms: { "=1": "Failed to collect delivery", other: "Failed to collect deliveries" },
      },
    });
    const fields = w.findAll("[data-testid='plural-field']");
    // exact =1 + en categories (one, other) = 3 rows, exact selector first
    expect(fields).toHaveLength(3);
    expect(fields[0]!.text()).toContain("=1");
    expect(fields[0]!.text()).toContain("Failed to collect delivery");
  });

  it("preserves an exact =1 selector when editing the 'other' form", async () => {
    const w = mount(PluralValueEditor, {
      props: {
        keyName: "deliveries.failed",
        locale: "en",
        sourceLocale: "en",
        arg: "count",
        forms: { "=1": "Failed to collect delivery", other: "Failed to collect deliveries" },
      },
    });
    // rows: [=1, one(empty), other] — edit the 'other' form (index 2).
    const fields = w.findAll("[data-testid='plural-field']");
    await fields[2]!.find("button").trigger("click");
    const input = w.get("input, textarea");
    await input.setValue("Could not collect deliveries");
    await input.trigger("blur");
    await flushPromises();
    expect(setPluralForms).toHaveBeenCalledWith("deliveries.failed", "en", {
      "=1": "Failed to collect delivery",
      other: "Could not collect deliveries",
    });
  });

  it("commits a field edit with the full merged forms object", async () => {
    const w = mount(PluralValueEditor, {
      props: {
        keyName: "cart.items",
        locale: "en",
        sourceLocale: "en",
        arg: "count",
        forms: { one: "{count} item", other: "{count} items" },
      },
    });
    // Open the first field (the "one" form) and edit it.
    await w.findAll("[data-testid='plural-field'] button")[0]!.trigger("click");
    const input = w.get("input, textarea");
    await input.setValue("{count} thing");
    await input.trigger("blur");
    await flushPromises();

    expect(setPluralForms).toHaveBeenCalledWith("cart.items", "en", {
      one: "{count} thing",
      other: "{count} items",
    });
    expect(w.emitted("changed")).toBeTruthy();
  });

  it("emits edit-start when opening a plural field editor", async () => {
    const w = mount(PluralValueEditor, {
      props: {
        keyName: "cart.items",
        locale: "en",
        sourceLocale: "en",
        arg: "count",
        forms: { one: "{count} item", other: "{count} items" },
      },
    });
    await w.findAll("[data-testid='plural-field'] button")[0]!.trigger("click");
    expect(w.emitted("edit-start")).toBeTruthy();
  });
});
