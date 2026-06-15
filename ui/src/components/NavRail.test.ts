import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import NavRail from "./NavRail.vue";

describe("NavRail", () => {
  beforeEach(() => {
    location.hash = "";
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the g-chord hint in a route's tooltip", async () => {
    vi.useFakeTimers();
    const wrapper = mount(NavRail, { attachTo: document.body });

    // Focus the first rail item (Editor) — reka-ui opens its tooltip, portalling
    // the content into the document where the hint chips become assertable.
    await wrapper.find('button[aria-label="Editor"]').trigger("focus");
    vi.advanceTimersByTime(400);
    await nextTick();

    const kbds = Array.from(document.querySelectorAll("kbd")).map((k) => k.textContent?.trim());
    expect(kbds).toContain("g");
    expect(kbds).toContain("e");
  });
});
