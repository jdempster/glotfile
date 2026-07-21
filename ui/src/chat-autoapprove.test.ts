import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick } from "vue";

vi.mock("./api", () => ({
  chatStream: vi.fn(),
  getChat: vi.fn(),
  clearChat: vi.fn(),
  confirmChatTool: vi.fn(async () => ({})),
  getLocalSettings: vi.fn(async () => ({})),
  getUiPrefs: vi.fn(async () => ({ theme: "system", chatAutoApprove: true })),
  putUiPrefs: vi.fn(async () => ({})),
}));

import { applyEvent, messages, autoApprove, setAutoApprove, syncAutoApprove, type UiMessage } from "./chat";
import { confirmChatTool, putUiPrefs } from "./api";

const confirmEvent = {
  type: "confirm-required" as const,
  batchId: "batch_1",
  items: [{ id: "t1", name: "set_key_context", humanSummary: "set context", input: {} }],
};

beforeEach(() => {
  vi.clearAllMocks();
  autoApprove.value = false;
  messages.value = [{ role: "user", text: "hi", tools: [] } satisfies UiMessage];
});

describe("Lingo auto-approve", () => {
  it("leaves the Approve card pending when off", async () => {
    applyEvent(messages.value, confirmEvent);
    await nextTick();
    expect(confirmChatTool).not.toHaveBeenCalled();
    expect(messages.value.at(-1)!.pendingConfirm).toEqual({ batchId: "batch_1" });
  });

  it("approves an incoming batch automatically when on, keeping the rows as the audit trail", async () => {
    autoApprove.value = true;
    applyEvent(messages.value, confirmEvent);
    await nextTick();
    expect(confirmChatTool).toHaveBeenCalledExactlyOnceWith("batch_1", true);
    const msg = messages.value.at(-1)!;
    expect(msg.pendingConfirm).toBeNull();
    // The batch resolves as approved-and-running, not silently vanished.
    expect(msg.tools[0]!.status).toBe("running");
  });

  it("resolves an already-waiting card when the toggle is flipped on", async () => {
    applyEvent(messages.value, confirmEvent);
    await nextTick();
    expect(confirmChatTool).not.toHaveBeenCalled();
    autoApprove.value = true;
    await nextTick();
    expect(confirmChatTool).toHaveBeenCalledExactlyOnceWith("batch_1", true);
  });

  it("setAutoApprove persists the choice to the machine-wide UI prefs", () => {
    setAutoApprove(true);
    expect(autoApprove.value).toBe(true);
    expect(putUiPrefs).toHaveBeenCalledExactlyOnceWith({ chatAutoApprove: true });
  });

  it("syncAutoApprove pulls the stored pref from the server", async () => {
    await syncAutoApprove();
    expect(autoApprove.value).toBe(true);
  });
});
