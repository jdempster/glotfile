import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import SelectionBar from "./SelectionBar.vue";
import { bulkClear, bulkDelete, bulkState, bulkMeta } from "@/api.js";

vi.mock("@/api.js", () => ({
  bulkClear: vi.fn(() => Promise.resolve({ cleared: 2 })),
  bulkDelete: vi.fn(() => Promise.resolve({ removed: ["a", "b"] })),
  bulkState: vi.fn(() => Promise.resolve({ updated: 2 })),
  bulkMeta: vi.fn(() => Promise.resolve({ updated: 2 })),
}));

vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const props = {
  keys: ["a", "b"],
  locales: ["fr"],
  scopeLabel: "fr",
  tagsOnSelection: ["nav"],
};

describe("SelectionBar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears translations after confirming", async () => {
    const w = mount(SelectionBar, { props, attachTo: document.body });
    await w.get('[data-testid="bulk-clear-trigger"]').trigger("click");
    const confirm = document.querySelector('[data-testid="bulk-clear-confirm"]') as HTMLElement;
    expect(confirm).not.toBeNull();
    confirm.click();
    await flushPromises();
    expect(bulkClear).toHaveBeenCalledWith(["a", "b"], ["fr"]);
    expect(w.emitted("changed")).toBeTruthy();
    // Selection is preserved so the user can chain further actions.
    expect(w.emitted("clear")).toBeFalsy();
  });

  it("deletes keys after confirming", async () => {
    const w = mount(SelectionBar, { props, attachTo: document.body });
    await w.get('[data-testid="bulk-delete-trigger"]').trigger("click");
    const confirm = document.querySelector('[data-testid="bulk-delete-confirm"]') as HTMLElement;
    expect(confirm).not.toBeNull();
    confirm.click();
    await flushPromises();
    expect(bulkDelete).toHaveBeenCalledWith(["a", "b"]);
    expect(w.emitted("changed")).toBeTruthy();
    // Deleted keys no longer exist, so the selection is cleared.
    expect(w.emitted("clear")).toBeTruthy();
  });

  it("emits translate without calling an API", async () => {
    const w = mount(SelectionBar, { props });
    await w.get('[data-testid="bulk-translate"]').trigger("click");
    expect(w.emitted("translate")).toBeTruthy();
  });

  it("marks reviewed via the Set menu", async () => {
    const w = mount(SelectionBar, { props, attachTo: document.body });
    await w.get('[data-testid="bulk-set-trigger"]').trigger("click");
    await nextTick();
    const item = document.querySelector('[data-testid="bulk-mark-reviewed"]') as HTMLElement;
    expect(item).not.toBeNull();
    item.click();
    await flushPromises();
    expect(bulkState).toHaveBeenCalledWith(["a", "b"], ["fr"], "reviewed");
    expect(w.emitted("changed")).toBeTruthy();
    // Marking state keeps the selection so the user can chain actions.
    expect(w.emitted("clear")).toBeFalsy();
  });

  it("adds a tag via the Set menu → Add tag dialog", async () => {
    const w = mount(SelectionBar, { props, attachTo: document.body });
    await w.get('[data-testid="bulk-set-trigger"]').trigger("click");
    await nextTick();
    const addItem = document.querySelector('[data-testid="bulk-set-trigger"]');
    // open the Add tag dialog via the menu item
    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    const addTagItem = menuItems.find((el) => el.textContent?.includes("Add tag"));
    expect(addTagItem).toBeTruthy();
    addTagItem!.click();
    await nextTick();
    const input = document.querySelector("#bulk-add-tag") as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = "promo";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    // press Enter to submit
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flushPromises();
    expect(bulkMeta).toHaveBeenCalledWith(["a", "b"], { addTags: ["promo"] });
    expect(w.emitted("changed")).toBeTruthy();
  });
});
