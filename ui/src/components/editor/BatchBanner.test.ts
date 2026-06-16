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
    vi.mocked(batchStatus).mockResolvedValue({ supported: true, pending: null });
    const w = mount(BatchBanner);
    await flushPromises();
    // v-if="pending" renders a comment node when null — the wrapper should have no element.
    expect(w.find("div").exists()).toBe(false);
  });

  it("shows progress while in flight and disables Apply", async () => {
    vi.mocked(batchStatus).mockResolvedValue({
      supported: true,
      pending: {
        batchId: "batch_1",
        createdAt: "2026-06-12T00:00:00Z",
        model: "claude-opus-4-8",
        total: 100,
        status: "in_progress",
        counts: { processing: 2, succeeded: 3, errored: 0, canceled: 0, expired: 0 },
      },
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
      .mockResolvedValueOnce({ supported: true, pending: pendingEnded })
      // After apply, batchStatus returns pending: null so banner disappears.
      .mockResolvedValue({ supported: true, pending: null });

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

    expect(batchApply).toHaveBeenCalledOnce();
    expect(w.emitted("changed")).toBeTruthy();

    // After refresh returns pending: null, the banner should be gone.
    expect(w.find("div").exists()).toBe(false);
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
