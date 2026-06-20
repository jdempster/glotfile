import { describe, it, expect, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import Toaster from "./Toaster.vue";
import { toast, useToasts } from ".";
import { isOpen, expanded } from "@/chat";
import { chatPanel } from "@/panel-widths.js";

// The container is teleported to <body>; grab the most recent one.
const container = () => {
  const all = document.body.querySelectorAll(".fixed.z-\\[200\\]");
  return all[all.length - 1] as HTMLElement | undefined;
};

let wrapper: VueWrapper | null = null;
const render = () => { wrapper = mount(Toaster, { attachTo: document.body }); };

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  useToasts().toasts.length = 0;
  isOpen.value = false;
  expanded.value = false;
});

describe("Toaster", () => {
  it("renders at top-center, clearing the nav rail, with no chat inset when closed", () => {
    isOpen.value = false;
    render();
    const el = container();
    expect(el?.className).toContain("top-3");
    expect(el?.className).toContain("items-center");
    expect(el?.style.left).toBe("56px");
    expect(el?.style.right).toBe("0px");
  });

  it("insets the right edge by the docked chat width so toasts stay clear of it", () => {
    isOpen.value = true;
    expanded.value = false;
    render();
    expect(container()?.style.right).toBe(`${chatPanel.width.value}px`);
  });

  it("shows a success toast with its accent icon chip and message", async () => {
    toast.success("Saved glotfile.json");
    render();
    await nextTick();
    const el = container();
    expect(el?.textContent).toContain("Saved glotfile.json");
    // The success variant gives the icon chip a solid reviewed-accent fill.
    expect(el?.querySelector(".bg-state-reviewed")).toBeTruthy();
  });
});
