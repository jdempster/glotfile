import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ChatMessage from "./ChatMessage.vue";
import type { UiMessage } from "@/chat";
import { knownKeys, knownLocales } from "@/keyIndex";
import * as drilldown from "@/drilldown";

describe("ChatMessage", () => {
  beforeEach(() => {
    knownKeys.value = new Set();
    knownLocales.value = new Set();
    vi.restoreAllMocks();
  });
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

  it("renders the message text before the tool rows", () => {
    const message: UiMessage = {
      role: "assistant",
      text: "Let me check the untranslated keys.",
      tools: [{ id: "t1", name: "filter_view", humanSummary: "filter to untranslated", status: "done" }],
    };
    const wrapper = mount(ChatMessage, { props: { message } });
    const html = wrapper.html();
    expect(html.indexOf("Let me check the untranslated keys")).toBeLessThan(html.indexOf("filter to untranslated"));
  });

  it("pretty-prints the tool result as indented monospace JSON when expanded", async () => {
    const message: UiMessage = {
      role: "assistant", text: "",
      tools: [{ id: "t1", name: "overview", humanSummary: "project overview", status: "done", result: { keyCount: 3, locales: ["en", "de"] } }],
    };
    const wrapper = mount(ChatMessage, { props: { message } });
    await wrapper.find("button").trigger("click");
    const pre = wrapper.find("pre");
    expect(pre.exists()).toBe(true);
    // Pretty-printed: indented, multi-line JSON rather than a single-line dump.
    expect(pre.text()).toContain('"keyCount": 3');
    expect(pre.text()).toContain("\n  ");
    // Monospace and roomy.
    expect(pre.classes()).toContain("font-mono");
  });

  it("shows one Approve/Skip card with a row per pending edit in the batch", () => {
    const message: UiMessage = {
      role: "assistant", text: "I'll add context to both keys and a glossary note.",
      tools: [
        { id: "t1", name: "set_key_context", humanSummary: "set context for plant.feed.cta", status: "pending-confirm", input: {} },
        { id: "t2", name: "set_glossary_term", humanSummary: "add glossary term \"feed\"", status: "pending-confirm", input: {} },
      ],
      pendingConfirm: { batchId: "t1" },
    };
    const wrapper = mount(ChatMessage, { props: { message } });
    // Each pending edit is listed…
    expect(wrapper.text()).toContain("set context for plant.feed.cta");
    expect(wrapper.text()).toContain('add glossary term "feed"');
    // …under a single Approve/Skip control for the whole batch.
    const labels = wrapper.findAll("button").map((b) => b.text());
    expect(labels.filter((t) => t.includes("Approve"))).toHaveLength(1);
    expect(labels.some((t) => t.includes("Skip"))).toBe(true);
  });

  it("renders a skipped row like a resolved row — collapsed, expandable, no 'Skipped.' line", async () => {
    const message: UiMessage = {
      role: "assistant", text: "",
      tools: [{ id: "t1", name: "set_key_context", humanSummary: "set context for plant.feed", status: "declined", input: { key: "plant.feed", context: "Fertilise the plant." } }],
      pendingConfirm: null,
    };
    const wrapper = mount(ChatMessage, { props: { message } });
    // No standalone "Skipped." line — it reads like an approved/done row.
    expect(wrapper.text()).not.toContain("Skipped.");
    // Collapsed but expandable: the row is a button that starts collapsed…
    const row = wrapper.find("button");
    expect(row.exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Fertilise the plant.");
    // …and expands to reveal what the edit would have been.
    await row.trigger("click");
    expect(wrapper.text()).toContain("Fertilise the plant.");
  });

  it("hides the Approve card once the batch is resolved", () => {
    const message: UiMessage = {
      role: "assistant", text: "",
      tools: [{ id: "t1", name: "set_key_context", humanSummary: "set context for plant.feed.cta", status: "done" }],
      pendingConfirm: null,
    };
    const wrapper = mount(ChatMessage, { props: { message } });
    expect(wrapper.findAll("button").map((b) => b.text()).some((t) => t.includes("Approve"))).toBe(false);
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

  it("makes a backticked real key clickable and focuses it", async () => {
    knownKeys.value = new Set(["plant.water"]);
    const spy = vi.spyOn(drilldown, "drillToKey").mockImplementation(() => {});
    const message: UiMessage = { role: "assistant", text: "Update `plant.water` for German.", tools: [] };
    const wrapper = mount(ChatMessage, { props: { message } });
    const code = wrapper.find("code.gf-key");
    expect(code.exists()).toBe(true);
    expect(code.text()).toBe("plant.water");
    await code.trigger("click");
    expect(spy).toHaveBeenCalledWith("plant.water");
  });

  it("leaves backticked non-keys inert", async () => {
    knownKeys.value = new Set(["plant.water"]);
    const spy = vi.spyOn(drilldown, "drillToKey").mockImplementation(() => {});
    // A source string, not a key/state/locale — it should not become a link.
    const message: UiMessage = { role: "assistant", text: "It says `Water your plant`.", tools: [] };
    const wrapper = mount(ChatMessage, { props: { message } });
    expect(wrapper.find("code.gf-key").exists()).toBe(false);
    await wrapper.find("code").trigger("click");
    expect(spy).not.toHaveBeenCalled();
  });

  it("makes a backticked review state clickable and filters the editor to it", async () => {
    const spy = vi.spyOn(drilldown, "drillTo").mockImplementation(() => {});
    const message: UiMessage = { role: "assistant", text: "You have 3 keys in `needs-review`.", tools: [] };
    const wrapper = mount(ChatMessage, { props: { message } });
    const code = wrapper.find("code.gf-key");
    expect(code.exists()).toBe(true);
    await code.trigger("click");
    expect(spy).toHaveBeenCalledWith({ states: ["needs-review"] });
  });

  it("makes a backticked project locale clickable and focuses it", async () => {
    knownLocales.value = new Set(["de"]);
    const spy = vi.spyOn(drilldown, "drillTo").mockImplementation(() => {});
    const message: UiMessage = { role: "assistant", text: "Let's look at `de`.", tools: [] };
    const wrapper = mount(ChatMessage, { props: { message } });
    const code = wrapper.find("code.gf-key");
    expect(code.exists()).toBe(true);
    await code.trigger("click");
    expect(spy).toHaveBeenCalledWith({ locale: "de" });
  });

  it("focuses a key on Enter for keyboard users", async () => {
    knownKeys.value = new Set(["plant.water"]);
    const spy = vi.spyOn(drilldown, "drillToKey").mockImplementation(() => {});
    const message: UiMessage = { role: "assistant", text: "See `plant.water`.", tools: [] };
    const wrapper = mount(ChatMessage, { props: { message } });
    await wrapper.find("code.gf-key").trigger("keydown", { key: "Enter" });
    expect(spy).toHaveBeenCalledWith("plant.water");
  });

  it("renders a plain user message without markdown HTML", () => {
    const message: UiMessage = { role: "user", text: "feed **now**", tools: [] };
    const wrapper = mount(ChatMessage, { props: { message } });
    expect(wrapper.html()).not.toContain("<strong>");
    expect(wrapper.text()).toContain("feed **now**");
  });
});
