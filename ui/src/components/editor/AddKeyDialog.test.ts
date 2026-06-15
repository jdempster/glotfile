import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AddKeyDialog from "./AddKeyDialog.vue";

vi.mock("@/api.js", () => ({
  createKey: vi.fn(() => Promise.resolve({})),
}));

import { createKey } from "@/api.js";

// The Dialog teleports its content to document.body, so the fields live outside
// the wrapper tree — query the document by id and dispatch native input events.
function setInput(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickAddKey() {
  for (const b of document.querySelectorAll<HTMLButtonElement>("button")) {
    if (b.textContent?.trim() === "Add key") b.click();
  }
}

describe("AddKeyDialog plural toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("calls createKey without a plural arg by default", async () => {
    mount(AddKeyDialog, { props: { open: true }, attachTo: document.body });
    await flushPromises();
    setInput("add-key", "home.title");
    setInput("add-value", "Welcome home");
    await flushPromises();
    clickAddKey();
    await flushPromises();

    expect(createKey).toHaveBeenCalledWith("home.title", "Welcome home");
  });

  it("passes the plural arg to createKey when the toggle is on", async () => {
    mount(AddKeyDialog, { props: { open: true }, attachTo: document.body });
    await flushPromises();
    setInput("add-key", "cart.items");
    setInput("add-value", "{count} items");

    // Flip the plural toggle on (the Switch lives in the teleported content).
    document.getElementById("add-plural")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    // The toggle reveals the count-arg field, defaulting to "count".
    expect(document.getElementById("add-plural-arg")).not.toBeNull();

    clickAddKey();
    await flushPromises();

    expect(createKey).toHaveBeenCalledWith("cart.items", "{count} items", { arg: "count" });
  });
});
