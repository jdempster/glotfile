import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import ChatPanel from "./ChatPanel.vue";
import { messages, isSending, loaded, expanded } from "@/chat";

beforeEach(() => {
  // Skip the on-mount history fetch (no server in tests).
  loaded.value = true;
  isSending.value = false;
  expanded.value = false;
  messages.value = [];
});

describe("ChatPanel thinking indicator", () => {
  it("shows while sending and awaiting the first reply", () => {
    messages.value = [{ role: "user", text: "hi", tools: [] }];
    isSending.value = true;
    const wrapper = mount(ChatPanel);
    expect(wrapper.find("[data-thinking]").exists()).toBe(true);
  });

  it("hides once assistant text is streaming", () => {
    messages.value = [
      { role: "user", text: "hi", tools: [] },
      { role: "assistant", text: "Hello", tools: [] },
    ];
    isSending.value = true;
    const wrapper = mount(ChatPanel);
    expect(wrapper.find("[data-thinking]").exists()).toBe(false);
  });

  it("hides while a tool row is already spinning", () => {
    messages.value = [
      { role: "user", text: "hi", tools: [] },
      { role: "assistant", text: "", tools: [{ id: "t1", name: "overview", humanSummary: "overview", status: "running" }] },
    ];
    isSending.value = true;
    const wrapper = mount(ChatPanel);
    expect(wrapper.find("[data-thinking]").exists()).toBe(false);
  });

  it("is absent when not sending", () => {
    messages.value = [{ role: "user", text: "hi", tools: [] }];
    isSending.value = false;
    const wrapper = mount(ChatPanel);
    expect(wrapper.find("[data-thinking]").exists()).toBe(false);
  });
});

describe("ChatPanel greeting rotation", () => {
  it("advances the rotating greeting on each open and shows it in the welcome", () => {
    localStorage.setItem("glotfile-lingo-greeting", "0");
    const wrapper = mount(ChatPanel);
    expect(localStorage.getItem("glotfile-lingo-greeting")).toBe("1");
    expect(wrapper.text()).toContain("I'm Lingo");
  });
});
