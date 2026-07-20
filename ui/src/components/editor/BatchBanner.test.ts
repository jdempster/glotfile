import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import BatchBanner from "./BatchBanner.vue";
import { batchStatus, batchApply, glossarySuggestBatchStatus, glossarySuggestBatchApply } from "@/api.js";

vi.mock("@/api.js", () => ({
  batchStatus: vi.fn(),
  batchApply: vi.fn(),
  batchCancel: vi.fn(),
  glossarySuggestBatchStatus: vi.fn(),
  glossarySuggestBatchApply: vi.fn(),
  glossarySuggestBatchCancel: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Stub window.confirm so cancel tests don't hang.
vi.stubGlobal("confirm", vi.fn(() => true));

describe("BatchBanner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when no batch is pending", async () => {
    vi.mocked(batchStatus).mockResolvedValue({ supported: true, pending: [] });
    const w = mount(BatchBanner);
    await flushPromises();
    // v-if renders a comment node when the list is empty — the wrapper should have no element.
    expect(w.find("div").exists()).toBe(false);
  });

  it("hides the banner when the provider does not support batch, even with a pending batch", async () => {
    // A batch can outlive the provider that started it (submitted under Anthropic,
    // then switched to a sync-only provider). Without a batch-capable provider it
    // can't be applied, so the banner must stay hidden.
    vi.mocked(batchStatus).mockResolvedValue({
      supported: false,
      pending: [{
        batchId: "batch_stale",
        createdAt: "2026-06-12T00:00:00Z",
        model: "claude-opus-4-8",
        total: 10,
        status: "ended",
        counts: { processing: 0, succeeded: 10, errored: 0, canceled: 0, expired: 0 },
      }],
    });
    const w = mount(BatchBanner);
    await flushPromises();
    expect(w.find("div").exists()).toBe(false);
  });

  it("shows progress while in flight and disables Apply", async () => {
    vi.mocked(batchStatus).mockResolvedValue({
      supported: true,
      pending: [{
        batchId: "batch_1",
        createdAt: "2026-06-12T00:00:00Z",
        model: "claude-opus-4-8",
        total: 100,
        status: "in_progress",
        counts: { processing: 2, succeeded: 3, errored: 0, canceled: 0, expired: 0 },
      }],
    });

    const w = mount(BatchBanner);
    await flushPromises();

    // The batch API doesn't report per-entry progress, so the banner just says processing.
    expect(w.text()).toContain("processing");

    // Apply button should be disabled because status is not "ended"
    const buttons = w.findAll("button");
    const applyBtn = buttons.find((b) => b.text().includes("Waiting"));
    expect(applyBtn).toBeTruthy();
    expect(applyBtn!.attributes("disabled")).toBeDefined();
  });

  it("applies when ended and emits changed", async () => {
    const pendingEnded = {
      batchId: "batch_2",
      createdAt: "2026-06-12T00:00:00Z",
      model: "claude-opus-4-8",
      total: 10,
      status: "ended" as const,
      counts: { processing: 0, succeeded: 10, errored: 0, canceled: 0, expired: 0 },
    };

    vi.mocked(batchStatus)
      .mockResolvedValueOnce({ supported: true, pending: [pendingEnded] })
      // After apply, batchStatus returns no pendings so the banner disappears.
      .mockResolvedValue({ supported: true, pending: [] });

    vi.mocked(batchApply).mockResolvedValue({
      written: 5,
      errors: [],
      staleSkipped: 1,
      retried: 0,
      screenshotsSkipped: 0,
    });

    const w = mount(BatchBanner);
    await flushPromises();

    // Banner should be visible with "Apply results" button enabled
    const buttons = w.findAll("button");
    const applyBtn = buttons.find((b) => b.text().includes("Apply results"));
    expect(applyBtn).toBeTruthy();
    expect(applyBtn!.attributes("disabled")).toBeUndefined();

    await applyBtn!.trigger("click");
    await flushPromises();

    expect(batchApply).toHaveBeenCalledExactlyOnceWith("batch_2");
    expect(w.emitted("changed")).toBeTruthy();

    // After refresh returns no pendings, the banner should be gone.
    expect(w.find("div").exists()).toBe(false);
  });

  it("renders a row per pending batch and applies only the clicked one", async () => {
    const base = {
      createdAt: "2026-06-12T00:00:00Z",
      model: "claude-opus-4-8",
      counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 },
    };
    vi.mocked(batchStatus).mockResolvedValue({
      supported: true,
      pending: [
        { ...base, batchId: "batch_fr", locales: ["fr"], total: 10, status: "ended" },
        { ...base, batchId: "batch_de", locales: ["de"], total: 12, status: "in_progress" },
      ],
    });
    vi.mocked(batchApply).mockResolvedValue({ written: 10, errors: [], staleSkipped: 0, retried: 0, screenshotsSkipped: 0 });

    const w = mount(BatchBanner);
    await flushPromises();

    // Both rows render, labelled with their locales; only the finished one is applicable.
    expect(w.text()).toContain("fr — 10");
    expect(w.text()).toContain("de — 12");
    const applyBtn = w.findAll("button").find((b) => b.text().includes("Apply results"));
    expect(applyBtn).toBeTruthy();
    await applyBtn!.trigger("click");
    await flushPromises();
    expect(batchApply).toHaveBeenCalledExactlyOnceWith("batch_fr");
  });
});

describe("BatchBanner glossary-suggest kind", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows Apply results button when glossary-suggest batch has ended", async () => {
    vi.mocked(glossarySuggestBatchStatus).mockResolvedValue({
      supported: true,
      pending: {
        batchId: "b",
        createdAt: "",
        model: "m",
        total: 3,
        status: "ended",
        counts: { processing: 0, succeeded: 3, errored: 0, canceled: 0, expired: 0 },
      },
    });

    const w = mount(BatchBanner, { props: { kind: "glossary-suggest" } });
    await flushPromises();

    // Banner should be visible and show "Apply results"
    const applyBtn = w.findAll("button").find((b) => b.text().includes("Apply results"));
    expect(applyBtn).toBeTruthy();
    expect(applyBtn!.attributes("disabled")).toBeUndefined();
  });

  it("calls glossarySuggestBatchApply and emits changed when Apply is clicked", async () => {
    const pendingEnded = {
      batchId: "b",
      createdAt: "",
      model: "m",
      total: 3,
      status: "ended" as const,
      counts: { processing: 0, succeeded: 3, errored: 0, canceled: 0, expired: 0 },
    };

    vi.mocked(glossarySuggestBatchStatus)
      .mockResolvedValueOnce({ supported: true, pending: pendingEnded })
      .mockResolvedValue({ supported: true, pending: null });

    vi.mocked(glossarySuggestBatchApply).mockResolvedValue({ added: 2, errors: [], retried: 0 });

    const w = mount(BatchBanner, { props: { kind: "glossary-suggest" } });
    await flushPromises();

    const applyBtn = w.findAll("button").find((b) => b.text().includes("Apply results"));
    expect(applyBtn).toBeTruthy();
    await applyBtn!.trigger("click");
    await flushPromises();

    expect(glossarySuggestBatchApply).toHaveBeenCalledOnce();
    expect(w.emitted("changed")).toBeTruthy();
  });
});
