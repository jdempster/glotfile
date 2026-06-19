import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ChatMessage from "./ChatMessage.vue";
import type { UiMessage } from "@/chat";

describe("ChatMessage", () => {
  it("renders assistant markdown as HTML", () => {
    const message: UiMessage = { role: "assistant", text: "Hello **gardener**", tools: [] };
    const wrapper = mount(ChatMessage, { props: { message } });
    expect(wrapper.html()).toContain("<strong>gardener</strong>");
  });

  it("renders a resolved tool row with its summary", () => {
    const message: UiMessage = {
      role: "assistant", text: "",
      tools: [{ id: "t1", name: "overview", humanSummary: "project overview", status: "done", result: { keyCount: 3 } }],
    };
    const wrapper = mount(ChatMessage, { props: { message } });
    expect(wrapper.text()).toContain("project overview");
  });

  it("shows Apply/Skip buttons for a pending-confirm tool", () => {
    const message: UiMessage = {
      role: "assistant", text: "",
      tools: [{ id: "t1", name: "run_translation", humanSummary: "translate 40 strings", status: "pending-confirm", input: { locales: ["de"] } }],
    };
    const wrapper = mount(ChatMessage, { props: { message } });
    const labels = wrapper.findAll("button").map((b) => b.text());
    expect(labels.some((t) => t.includes("Apply"))).toBe(true);
    expect(labels.some((t) => t.includes("Skip"))).toBe(true);
  });

  it("does not render raw HTML from assistant markdown as live nodes (XSS)", () => {
    const message: UiMessage = {
      role: "assistant",
      text: "Look <img src=x onerror=\"alert(1)\"> and <script>alert(2)</script> **bold**",
      tools: [],
    };
    const wrapper = mount(ChatMessage, { props: { message } });
    // Raw HTML is escaped to text, so no live <script>/<img> nodes exist…
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find("img").exists()).toBe(false);
    // …while legitimate markdown still renders.
    expect(wrapper.find("strong").exists()).toBe(true);
  });

  it("renders a plain user message without markdown HTML", () => {
    const message: UiMessage = { role: "user", text: "feed **now**", tools: [] };
    const wrapper = mount(ChatMessage, { props: { message } });
    expect(wrapper.html()).not.toContain("<strong>");
    expect(wrapper.text()).toContain("feed **now**");
  });
});
