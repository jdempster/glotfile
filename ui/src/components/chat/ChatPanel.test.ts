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

  it("stays up while the model narrates and then generates its tool calls", () => {
    // After text streams, the model generates tool_use blocks with NO events
    // until the turn ends — the dead air the dots must cover.
    messages.value = [
      { role: "user", text: "hi", tools: [] },
      { role: "assistant", text: "Let me check that.", tools: [] },
    ];
    isSending.value = true;
    const wrapper = mount(ChatPanel);
    expect(wrapper.find("[data-thinking]").exists()).toBe(true);
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

  it("shows between steps when a narrated tool call has finished", () => {
    // A turn that narrated text then ran a tool which has now completed: the model
    // is deciding its next move, so the indicator must stay up.
    messages.value = [
      { role: "user", text: "hi", tools: [] },
      { role: "assistant", text: "Let me check that.", tools: [{ id: "t1", name: "overview", humanSummary: "overview", status: "done" }] },
    ];
    isSending.value = true;
    const wrapper = mount(ChatPanel);
    expect(wrapper.find("[data-thinking]").exists()).toBe(true);
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
