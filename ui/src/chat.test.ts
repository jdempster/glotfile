import { describe, it, expect } from "vitest";
import { applyEvent, transcriptToUi, type UiMessage } from "./chat";
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

  it("surfaces a confirm-required tool as pending-confirm with its input", () => {
    const msgs = withUser("translate everything");
    applyEvent(msgs, { type: "confirm-required", id: "t1", name: "run_translation", humanSummary: "translate 40 strings", input: { locales: ["de"] } });
    const tool = msgs[1]!.tools[0]!;
    expect(tool.status).toBe("pending-confirm");
    expect(tool.input).toEqual({ locales: ["de"] });
  });

  it("upserts the same tool id (confirm-required then tool-start) without duplicating", () => {
    const msgs = withUser("go");
    applyEvent(msgs, { type: "confirm-required", id: "t1", name: "bulk_clear", humanSummary: "clear de", input: {} });
    applyEvent(msgs, { type: "tool-start", id: "t1", name: "bulk_clear", humanSummary: "clear de" });
    expect(msgs[1]!.tools).toHaveLength(1);
    expect(msgs[1]!.tools[0]!.status).toBe("running");
  });

  it("records an error event on the assistant message", () => {
    const msgs = withUser("hi");
    applyEvent(msgs, { type: "error", error: "Anthropic only" });
    expect(msgs[1]!.error).toBe("Anthropic only");
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
});
