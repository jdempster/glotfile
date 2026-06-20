import { describe, it, expect } from "vitest";
import { applyEvent, transcriptToUi, viewFilterFromEvent, selectKeyFromEvent, drillKeyFromEvent, messages, pendingConfirm, type UiMessage } from "./chat";
import type { ChatMessage } from "./types";

function withUser(text: string): UiMessage[] {
  return [{ role: "user", text, tools: [] }];
}

describe("applyEvent (chat stream reducer)", () => {
  it("accumulates assistant text deltas into a trailing assistant message", () => {
    const msgs = withUser("hi");
    applyEvent(msgs, { type: "text", delta: "Hello " });
    applyEvent(msgs, { type: "text", delta: "there." });
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.role).toBe("assistant");
    expect(msgs[1]!.text).toBe("Hello there.");
  });

  it("turn-start opens a fresh bubble so consecutive turns don't merge", () => {
    const msgs = withUser("hi");
    applyEvent(msgs, { type: "turn-start" });
    applyEvent(msgs, { type: "text", delta: "Let me look." });
    applyEvent(msgs, { type: "turn-start" });
    applyEvent(msgs, { type: "text", delta: "Here's the answer." });
    expect(msgs).toHaveLength(3); // user + two separate assistant turns
    expect(msgs[1]!.text).toBe("Let me look.");
    expect(msgs[2]!.text).toBe("Here's the answer.");
  });

  it("shows a retry notice and clears it once output lands", () => {
    const msgs = withUser("hi");
    applyEvent(msgs, { type: "turn-start" });
    applyEvent(msgs, { type: "retry", attempt: 1, total: 3 });
    expect(msgs[1]!.notice).toBe("Retrying… 1/3");
    applyEvent(msgs, { type: "retry", attempt: 2, total: 3 });
    expect(msgs[1]!.notice).toBe("Retrying… 2/3");
    applyEvent(msgs, { type: "text", delta: "ok" });
    expect(msgs[1]!.notice).toBeNull();
    expect(msgs[1]!.text).toBe("ok");
  });

  it("clears a retry notice when the turn errors out", () => {
    const msgs = withUser("hi");
    applyEvent(msgs, { type: "retry", attempt: 1, total: 3 });
    applyEvent(msgs, { type: "error", error: "boom" });
    expect(msgs[1]!.notice).toBeNull();
    expect(msgs[1]!.error).toBe("boom");
  });

  it("adds a tool row on tool-start and resolves it on tool-end", () => {
    const msgs = withUser("how many keys?");
    applyEvent(msgs, { type: "tool-start", id: "t1", name: "overview", humanSummary: "project overview" });
    let tool = msgs[1]!.tools[0]!;
    expect(tool).toMatchObject({ id: "t1", name: "overview", status: "running" });
    applyEvent(msgs, { type: "tool-end", id: "t1", result: { keyCount: 3 } });
    tool = msgs[1]!.tools[0]!;
    expect(tool.status).toBe("done");
    expect(tool.result).toEqual({ keyCount: 3 });
  });

  it("marks a tool errored on tool-end with error", () => {
    const msgs = withUser("x");
    applyEvent(msgs, { type: "tool-start", id: "t1", name: "read_file", humanSummary: "read x" });
    applyEvent(msgs, { type: "tool-end", id: "t1", error: "not found" });
    expect(msgs[1]!.tools[0]!.status).toBe("error");
    expect(msgs[1]!.tools[0]!.error).toBe("not found");
  });

  it("surfaces a confirm-required batch as pending-confirm rows and flags the message", () => {
    const msgs = withUser("set up the German feed keys");
    applyEvent(msgs, { type: "confirm-required", batchId: "t1", items: [
      { id: "t1", name: "set_key_context", humanSummary: "set context for plant.feed.cta", input: { key: "plant.feed.cta", context: "fertilising" } },
      { id: "t2", name: "set_glossary_term", humanSummary: "add glossary term \"feed\"", input: { term: "feed" } },
    ] });
    const msg = msgs[1]!;
    expect(msg.tools).toHaveLength(2);
    expect(msg.tools.every((t) => t.status === "pending-confirm")).toBe(true);
    expect(msg.tools[0]!.input).toEqual({ key: "plant.feed.cta", context: "fertilising" });
    // One Approve/Skip card governs the whole batch.
    expect(msg.pendingConfirm).toEqual({ batchId: "t1" });
  });

  it("upserts the same tool id (confirm-required then tool-start) without duplicating", () => {
    const msgs = withUser("go");
    applyEvent(msgs, { type: "confirm-required", batchId: "t1", items: [{ id: "t1", name: "set_source_text", humanSummary: "set source text", input: {} }] });
    applyEvent(msgs, { type: "tool-start", id: "t1", name: "set_source_text", humanSummary: "set source text" });
    expect(msgs[1]!.tools).toHaveLength(1);
    expect(msgs[1]!.tools[0]!.status).toBe("running");
  });

  it("records an error event on the assistant message", () => {
    const msgs = withUser("hi");
    applyEvent(msgs, { type: "error", error: "Anthropic only" });
    expect(msgs[1]!.error).toBe("Anthropic only");
  });

  it("renders a skipped edit's (non-error) declined tool-end as declined, not done", () => {
    const msgs = withUser("go");
    applyEvent(msgs, { type: "confirm-required", batchId: "t1", items: [{ id: "t1", name: "set_key_context", humanSummary: "set context", input: {} }] });
    applyEvent(msgs, { type: "tool-end", id: "t1", result: { declined: true } });
    expect(msgs[1]!.tools[0]!.status).toBe("declined");
  });
});

describe("viewFilterFromEvent", () => {
  it("extracts the viewFilter the editor should apply from a filter_view tool-end", () => {
    const vf = viewFilterFromEvent({
      type: "tool-end",
      id: "t1",
      result: { ok: true, matched: 2, viewFilter: { states: ["missing"], locale: "de" } },
    });
    expect(vf).toEqual({ states: ["missing"], locale: "de" });
  });

  it("returns an empty filter object when filter_view cleared the view", () => {
    const vf = viewFilterFromEvent({ type: "tool-end", id: "t1", result: { ok: true, viewFilter: {} } });
    expect(vf).toEqual({});
  });

  it("returns null for a tool-end that carries no viewFilter", () => {
    expect(viewFilterFromEvent({ type: "tool-end", id: "t1", result: { keyCount: 3 } })).toBeNull();
  });

  it("returns null for an errored tool-end even if a result is present", () => {
    expect(viewFilterFromEvent({ type: "tool-end", id: "t1", error: "boom", result: { viewFilter: {} } })).toBeNull();
  });

  it("returns null for non-tool-end events", () => {
    expect(viewFilterFromEvent({ type: "text", delta: "hi" })).toBeNull();
    expect(viewFilterFromEvent({ type: "turn-start" })).toBeNull();
  });
});

describe("selectKeyFromEvent", () => {
  it("extracts the key to open from a select_key tool-end", () => {
    expect(selectKeyFromEvent({ type: "tool-end", id: "t1", result: { ok: true, selectKey: "plant.feed" } })).toBe("plant.feed");
  });

  it("returns null for a tool-end with no selectKey", () => {
    expect(selectKeyFromEvent({ type: "tool-end", id: "t1", result: { ok: true, viewFilter: {} } })).toBeNull();
  });

  it("returns null for an errored tool-end and for non-tool-end events", () => {
    expect(selectKeyFromEvent({ type: "tool-end", id: "t1", error: "boom", result: { selectKey: "x" } })).toBeNull();
    expect(selectKeyFromEvent({ type: "text", delta: "hi" })).toBeNull();
  });
});

describe("drillKeyFromEvent", () => {
  it("extracts the new key to drill to from an add_key tool-end", () => {
    expect(drillKeyFromEvent({ type: "tool-end", id: "t1", result: { ok: true, key: "plant.repot", source: "Repot your plant", drillToKey: "plant.repot" } })).toBe("plant.repot");
  });

  it("returns null for a tool-end with no drillToKey (e.g. a plain edit)", () => {
    expect(drillKeyFromEvent({ type: "tool-end", id: "t1", result: { ok: true, key: "plant.water" } })).toBeNull();
  });

  it("returns null for an errored tool-end and for non-tool-end events", () => {
    expect(drillKeyFromEvent({ type: "tool-end", id: "t1", error: "boom", result: { drillToKey: "x" } })).toBeNull();
    expect(drillKeyFromEvent({ type: "turn-start" })).toBeNull();
  });
});

describe("transcriptToUi", () => {
  it("rebuilds user/assistant bubbles and tool rows from a persisted transcript", () => {
    const transcript: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "how many keys?" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "overview", input: {} }] },
      { role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: "{\"keyCount\":3}" }] },
      { role: "assistant", content: [{ type: "text", text: "You have 3 keys." }] },
    ];
    const ui = transcriptToUi(transcript);
    expect(ui[0]).toMatchObject({ role: "user", text: "how many keys?" });
    // the tool_use assistant message carries a resolved tool row
    const toolMsg = ui.find((m) => m.tools.length > 0)!;
    expect(toolMsg.tools[0]).toMatchObject({ id: "t1", name: "overview", status: "done" });
    expect(ui[ui.length - 1]).toMatchObject({ role: "assistant", text: "You have 3 keys." });
  });

  it("restores a skipped edit as declined (not done) on reload", () => {
    const transcript: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "set_key_context", input: {} }] },
      { role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: "The user declined to run this action." }] },
    ];
    const ui = transcriptToUi(transcript);
    const toolMsg = ui.find((m) => m.tools.length > 0)!;
    expect(toolMsg.tools[0]!.status).toBe("declined");
  });
});

describe("pendingConfirm (store accessor)", () => {
  it("exposes the latest message's awaiting batch, or null once resolved", () => {
    messages.value = [];
    expect(pendingConfirm.value).toBeNull();
    messages.value = [{ role: "assistant", text: "", tools: [], pendingConfirm: { batchId: "b1" } }];
    expect(pendingConfirm.value).toEqual({ batchId: "b1" });
    messages.value[0]!.pendingConfirm = null;
    expect(pendingConfirm.value).toBeNull();
    messages.value = [];
  });
});
