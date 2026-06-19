import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import ChatDock from "./ChatDock.vue";
import { isOpen, expanded, available } from "@/chat";

beforeEach(() => {
  isOpen.value = false;
  expanded.value = false;
  available.value = true;
});

describe("ChatDock", () => {
  it("renders nothing when closed", () => {
    const wrapper = mount(ChatDock);
    expect(wrapper.find("aside").exists()).toBe(false);
    expect(wrapper.find("[data-chat-backdrop]").exists()).toBe(false);
  });

  it("renders a docked, resizable side column (no backdrop) when open and not expanded", () => {
    isOpen.value = true;
    const wrapper = mount(ChatDock);
    expect(wrapper.find("aside").exists()).toBe(true);
    expect(wrapper.find('[role="separator"]').exists()).toBe(true); // resize handle
    expect(wrapper.find("[data-chat-backdrop]").exists()).toBe(false);
  });

  it("renders a drawer over a dimmed backdrop when expanded", () => {
    isOpen.value = true;
    expanded.value = true;
    const wrapper = mount(ChatDock);
    expect(wrapper.find("aside").exists()).toBe(true);
    expect(wrapper.find("[data-chat-backdrop]").exists()).toBe(true);
  });

  it("renders nothing when the chat feature is unavailable, even if open", () => {
    available.value = false;
    isOpen.value = true;
    const wrapper = mount(ChatDock);
    expect(wrapper.find("aside").exists()).toBe(false);
  });
});
