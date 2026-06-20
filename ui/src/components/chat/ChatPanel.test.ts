import { describe, it, expect, beforeEach, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import ChatPanel from "./ChatPanel.vue";
import { messages, isSending, loaded, expanded, type UiMessage } from "@/chat";

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

describe("ChatPanel approve/skip keyboard shortcut", () => {
  const pendingMsgs = (): UiMessage[] => [
    { role: "user", text: "set it up", tools: [] },
    {
      role: "assistant", text: "I'll add context.",
      tools: [{ id: "t1", name: "set_key_context", humanSummary: "set context for plant.feed", status: "pending-confirm", input: {} }],
      pendingConfirm: { batchId: "t1" },
    },
  ];

  it("A approves the pending batch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    messages.value = pendingMsgs();
    mount(ChatPanel);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    await nextTick();
    expect(messages.value[1]!.pendingConfirm).toBeNull();
    expect(messages.value[1]!.tools[0]!.status).toBe("running");
    vi.unstubAllGlobals();
  });

  it("S skips the pending batch (rows go declined, not done)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    messages.value = pendingMsgs();
    mount(ChatPanel);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    await nextTick();
    expect(messages.value[1]!.tools[0]!.status).toBe("declined");
    vi.unstubAllGlobals();
  });

  it("ignores the shortcut while the user is typing in the composer", async () => {
    messages.value = pendingMsgs();
    const wrapper = mount(ChatPanel);
    // A keystroke originating in the textarea must type, not approve.
    wrapper.find("textarea").element.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    await nextTick();
    expect(messages.value[1]!.pendingConfirm).toEqual({ batchId: "t1" });
  });

  it("blocks the composer while a decision is outstanding", () => {
    messages.value = pendingMsgs();
    const wrapper = mount(ChatPanel);
    expect(wrapper.find("textarea").attributes("disabled")).toBeDefined();
  });

  it("leaves the composer enabled when nothing is awaiting a decision", () => {
    messages.value = [
      { role: "assistant", text: "done", tools: [{ id: "t1", name: "set_key_context", humanSummary: "x", status: "done" }], pendingConfirm: null },
    ];
    const wrapper = mount(ChatPanel);
    expect(wrapper.find("textarea").attributes("disabled")).toBeUndefined();
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
