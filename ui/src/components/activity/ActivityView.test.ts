import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ActivityView from "./ActivityView.vue";
import type { LogEntry } from "@/types.js";

vi.mock("@/api.js", () => ({ getLog: vi.fn() }));
import { getLog } from "@/api.js";

const aiEntry: LogEntry = {
  at: "2026-06-04T10:00:00.000Z",
  kind: "translate",
  summary: "Translated 1 item to fr",
  model: "claude-opus-4-8",
  system: "You are a translator.",
  items: [{ id: "1", key: "home.title", source: "Home", targetLocale: "fr", glossary: [{ term: "Sign in", forced: "Se connecter" }] }],
  results: [{ id: "1", translation: "Accueil" }],
};
const editEntry: LogEntry = {
  at: "2026-06-04T11:00:00.000Z",
  kind: "translation",
  summary: "Set fr value of auth.title",
  key: "auth.title",
  locale: "fr",
  before: "Connexion",
  after: "Se connecter",
};

describe("ActivityView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders AI detail and a general edit's before → after", async () => {
    vi.mocked(getLog).mockResolvedValue([editEntry, aiEntry]);
    const w = mount(ActivityView);
    await flushPromises();
    const text = w.text();
    expect(text).toContain("claude-opus-4-8");
    expect(text).toContain("home.title");
    expect(text).toContain("Accueil");
    expect(text).toContain("Sign in → Se connecter");
    expect(text).toContain("Set fr value of auth.title");
    expect(text).toContain("Connexion");
    expect(text).toContain("Se connecter");
  });

  it("filters entries by kind", async () => {
    vi.mocked(getLog).mockResolvedValue([editEntry, aiEntry]);
    const w = mount(ActivityView);
    await flushPromises();
    const chip = w.findAll("button").find((b) => b.text() === "translate");
    expect(chip).toBeTruthy();
    await chip!.trigger("click");
    expect(w.text()).not.toContain("Set fr value of auth.title");
    expect(w.text()).toContain("home.title");
  });

  it("renders object values like plural forms as monospaced JSON", async () => {
    const pluralEntry: LogEntry = {
      at: "2026-06-04T12:00:00.000Z",
      kind: "translation",
      summary: "Set fr plural forms of cart.items",
      key: "cart.items",
      locale: "fr",
      before: { one: "1 article", other: "{count} articles" },
      after: { one: "un article", other: "{count} articles" },
    };
    vi.mocked(getLog).mockResolvedValue([pluralEntry]);
    const w = mount(ActivityView);
    await flushPromises();
    const afterEl = w.findAll("span").find((s) => s.text().includes('"one":"un article"'));
    expect(afterEl).toBeTruthy();
    expect(afterEl!.classes()).toContain("font-mono");
  });

  it("shows the empty state when there are no entries", async () => {
    vi.mocked(getLog).mockResolvedValue([]);
    const w = mount(ActivityView);
    await flushPromises();
    expect(w.text()).toContain("No activity yet");
  });

  it("collapses a large AI run by default, showing only a summary", async () => {
    const big: LogEntry = {
      at: "2026-06-04T10:00:00.000Z",
      kind: "translate",
      summary: "Translated 200 items to fr",
      model: "claude-opus-4-8",
      system: "sys",
      items: Array.from({ length: 200 }, (_, i) => ({ id: String(i), key: `k${i}`, source: `s${i}`, targetLocale: "fr" })),
      results: Array.from({ length: 200 }, (_, i) => ({ id: String(i), translation: `t${i}` })),
    };
    vi.mocked(getLog).mockResolvedValue([big]);
    const w = mount(ActivityView);
    await flushPromises();

    // Summary is shown, but none of the 200 item rows are mounted (the 30s-lock cause).
    expect(w.text()).toContain("200 items");
    expect(w.text()).not.toContain("s0");
    expect(w.findAll("li").length).toBe(0);
    // A toggle to reveal them is offered.
    expect(w.findAll("button").some((b) => /show .*items/i.test(b.text()))).toBe(true);
  });

  it("summarizes the error count of a run", async () => {
    const entry: LogEntry = {
      at: "2026-06-04T10:00:00.000Z",
      kind: "translate",
      summary: "Translated 5 items to fr",
      model: "claude-opus-4-8",
      system: "sys",
      items: Array.from({ length: 5 }, (_, i) => ({ id: String(i), key: `k${i}`, source: `s${i}`, targetLocale: "fr" })),
      results: [
        { id: "0", translation: "t0" }, { id: "1", error: "boom" }, { id: "2", translation: "t2" },
        { id: "3", error: "boom" }, { id: "4", translation: "t4" },
      ],
    };
    vi.mocked(getLog).mockResolvedValue([entry]);
    const w = mount(ActivityView);
    await flushPromises();
    expect(w.text()).toMatch(/2 errors/);
  });

  it("expands a collapsed run to show its items, matching results by id", async () => {
    // 30 items: collapsed by default (> auto-open threshold), but plain-rendered
    // when opened (<= virtualize threshold), so content is assertable here.
    const entry: LogEntry = {
      at: "2026-06-04T10:00:00.000Z",
      kind: "translate",
      summary: "Translated 30 items to fr",
      model: "claude-opus-4-8",
      system: "sys",
      items: Array.from({ length: 30 }, (_, i) => ({ id: String(i), key: `k${i}`, source: `s${i}`, targetLocale: "fr" })),
      results: Array.from({ length: 30 }, (_, i) => ({ id: String(i), translation: `t${i}` })),
    };
    vi.mocked(getLog).mockResolvedValue([entry]);
    const w = mount(ActivityView);
    await flushPromises();
    expect(w.text()).not.toContain("s0"); // collapsed

    const toggle = w.findAll("button").find((b) => /show .*items/i.test(b.text()))!;
    await toggle.trigger("click");
    // First and last items render, and the last item's result is matched by id
    // (guards the O(1) lookup that replaced the O(n²) per-item find).
    expect(w.text()).toContain("s0");
    expect(w.text()).toContain("s29");
    expect(w.text()).toContain("t29");
  });
});
