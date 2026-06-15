import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ScanListField from "./ScanListField.vue";

function mountField(props: Record<string, unknown> = {}) {
  return mount(ScanListField, { props: { label: "Test", items: [], ...props } });
}

describe("ScanListField", () => {
  it("emits update:items with the trimmed value on Enter", async () => {
    const w = mountField();
    await w.find("input").setValue("  translations  ");
    await w.find("input").trigger("keydown.enter");
    expect(w.emitted("update:items")?.[0]).toEqual([["translations"]]);
  });

  it("rejects a duplicate without emitting", async () => {
    const w = mountField({ items: ["loc"] });
    await w.find("input").setValue("loc");
    await w.find("input").trigger("keydown.enter");
    expect(w.emitted("update:items")).toBeFalsy();
    expect(w.text()).toContain("already listed");
  });

  it("rejects a value the validator fails and surfaces the error", async () => {
    const validate = (v: string) => (v === "bad(" ? "Invalid regex: oops" : null);
    const w = mountField({ validate });
    await w.find("input").setValue("bad(");
    await w.find("input").trigger("keydown.enter");
    expect(w.emitted("update:items")).toBeFalsy();
    expect(w.text()).toContain("Invalid regex");
  });

  it("accepts a value the validator passes", async () => {
    const w = mountField({ validate: () => null });
    await w.find("input").setValue("ok");
    await w.find("input").trigger("keydown.enter");
    expect(w.emitted("update:items")?.[0]).toEqual([["ok"]]);
  });

  it("emits the list without the removed item", async () => {
    const w = mountField({ items: ["a", "b"] });
    const removeBtn = w.findAll("button").find((b) => b.attributes("aria-label") === "Remove a")!;
    await removeBtn.trigger("click");
    expect(w.emitted("update:items")?.[0]).toEqual([["b"]]);
  });
});
