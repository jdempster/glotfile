import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { useNavHotkeys, shortcutsOpen } from "./useNavHotkeys.js";

// A throwaway host so the composable's onMounted/onUnmounted lifecycle runs.
const Host = defineComponent({
  setup() {
    useNavHotkeys();
    return () => h("div");
  },
});

function press(key: string, opts: KeyboardEventInit = {}, target?: EventTarget) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  (target ?? window).dispatchEvent(e);
  return e;
}

describe("useNavHotkeys", () => {
  let wrapper: ReturnType<typeof mount>;

  beforeEach(() => {
    location.hash = "";
    shortcutsOpen.value = false;
    document.body.replaceChildren();
    wrapper = mount(Host, { attachTo: document.body });
  });

  afterEach(() => {
    wrapper.unmount();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("navigates on a complete g-chord and prevents default", () => {
    press("g");
    const e = press("e");
    expect(location.hash).toBe("#editor");
    expect(e.defaultPrevented).toBe(true);
  });

  it("resolves a second g to Glossary", () => {
    press("g");
    press("g");
    expect(location.hash).toBe("#glossary");
  });

  it("toggles the shortcuts overlay on ? from idle", () => {
    const e = press("?");
    expect(shortcutsOpen.value).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  it("stops listening after unmount", () => {
    wrapper.unmount();
    press("g");
    press("e");
    expect(location.hash).toBe("");
  });

  describe("guards", () => {
    it("ignores the chord when a meta/ctrl/alt modifier is held", () => {
      press("g");
      press("e", { ctrlKey: true });
      expect(location.hash).toBe("");
    });

    it("ignores auto-repeat keydowns", () => {
      press("g");
      press("e", { repeat: true });
      expect(location.hash).toBe("");
    });

    it("does not fire while typing in an input", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      press("g", {}, input);
      press("e", {}, input);
      expect(location.hash).toBe("");
    });

    it("does not fire while a popover/menu/dialog is open", () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      document.body.appendChild(dialog);
      press("g");
      press("e");
      expect(location.hash).toBe("");
    });

    it("lets ? close the shortcuts dialog when it is the open overlay", () => {
      shortcutsOpen.value = true;
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      document.body.appendChild(dialog);
      press("?");
      expect(shortcutsOpen.value).toBe(false);
    });

    it("does not let ? open help while a different dialog is open", () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      document.body.appendChild(dialog);
      press("?");
      expect(shortcutsOpen.value).toBe(false);
    });
  });

  describe("chord timeout", () => {
    it("resets the armed chord after ~1000ms", () => {
      vi.useFakeTimers();
      press("g");
      vi.advanceTimersByTime(1100);
      press("e");
      expect(location.hash).toBe("");
    });

    it("still resolves a chord completed before the timeout", () => {
      vi.useFakeTimers();
      press("g");
      vi.advanceTimersByTime(500);
      press("e");
      expect(location.hash).toBe("#editor");
    });
  });
});
