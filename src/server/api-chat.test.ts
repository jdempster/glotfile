import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "./api.js";
import { createEventHub } from "./events.js";
import { saveState } from "./state.js";
import { defaultState } from "./schema.js";
import type { ChatEvent } from "./ai/chat-types.js";

function setup(opts: { chatTurns?: ChatEvent[][]; chat?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "glot-chat-"));
  const file = join(dir, "glotfile.json");
  const s = defaultState();
  s.config.locales = ["en", "de"];
  s.keys = { "plant.water": { values: { en: { value: "Water your plant", state: "source" } } } };
  saveState(file, s);

  let i = 0;
  const turns = opts.chatTurns ?? [[{ type: "text", delta: "Hi! I can help set up Sprout." }, { type: "turn_end", stopReason: "end_turn", content: [{ type: "text", text: "Hi! I can help set up Sprout." }] }]];
  const provider: Record<string, unknown> = {
    supportsVision: () => false,
    translate: async () => [],
    takeUsage: () => undefined,
  };
  // Omit chat() entirely to simulate a non-chat provider.
  if (opts.chat !== false) {
    provider.chat = async function* () {
      const t = turns[i++] ?? [{ type: "turn_end", stopReason: "end_turn", content: [] }];
      for (const e of t) yield e;
    };
  }
  // Capture live-reload broadcasts so a test can assert the UI is told to refresh.
  const broadcasts: string[] = [];
  const eventHub = createEventHub();
  eventHub.subscribe((event) => { broadcasts.push(event); });
  return { dir, file, broadcasts, app: createApi({ statePath: file, eventHub, makeProvider: () => provider as never }) };
}

async function collectSSE(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const text = await res.text();
  const events: Array<{ event: string; data: unknown }> = [];
  let currentEvent = "message";
  for (const line of text.split("\n")) {
    if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      events.push({ event: currentEvent, data: JSON.parse(line.slice(5).trim()) });
      currentEvent = "message";
    }
  }
  return events;
}

const post = (app: ReturnType<typeof createApi>, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Like collectSSE, but consumes the stream incrementally so it can answer the
// confirm-required prompt mid-turn (write tools are confirm-gated): on the first
// confirm-required it POSTs an Approve/Skip on a separate request, letting the
// suspended turn finish. Without this a gated turn would block forever.
async function collectSSEAnswering(
  res: Response,
  app: ReturnType<typeof createApi>,
  approve = true,
): Promise<Array<{ event: string; data: unknown }>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ event: string; data: unknown }> = [];
  let buf = "";
  let currentEvent = "message";
  let answered = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        const data = JSON.parse(line.slice(5).trim());
        events.push({ event: currentEvent, data });
        if (currentEvent === "confirm-required" && !answered) {
          answered = true;
          void post(app, "/chat/confirm", { batchId: (data as { batchId: string }).batchId, approved: approve });
        }
        currentEvent = "message";
      }
    }
  }
  return events;
}

describe("chat endpoints", () => {
  it("GET /chat returns an empty transcript for a fresh project", async () => {
    const { app } = setup();
    const t = await (await app.request("/chat")).json();
    expect(t.messages).toEqual([]);
  });

  it("POST /chat/stream streams a turn and persists the transcript", async () => {
    const { app } = setup();
    const events = await collectSSE(await post(app, "/chat/stream", { message: "help me" }));
    expect(events.some((e) => e.event === "text")).toBe(true);
    expect(events[events.length - 1]!.event).toBe("done");

    const t = await (await app.request("/chat")).json();
    // user message + assistant reply persisted
    expect(t.messages).toHaveLength(2);
    expect(t.messages[0].role).toBe("user");
    expect(t.messages[1].role).toBe("assistant");
  });

  it("DELETE /chat clears the transcript", async () => {
    const { app } = setup();
    // Drain the SSE so the handler's persist runs before we assert.
    await collectSSE(await post(app, "/chat/stream", { message: "hi" }));
    expect((await (await app.request("/chat")).json()).messages.length).toBe(2);
    await app.request("/chat", { method: "DELETE" });
    expect((await (await app.request("/chat")).json()).messages).toEqual([]);
  });

  it("a tool turn runs the tool and feeds the result back", async () => {
    const { app } = setup({
      chatTurns: [
        [{ type: "turn_end", stopReason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "overview", input: {} }] }],
        [{ type: "text", delta: "You have 1 key." }, { type: "turn_end", stopReason: "end_turn", content: [{ type: "text", text: "You have 1 key." }] }],
      ],
    });
    const events = await collectSSE(await post(app, "/chat/stream", { message: "how many keys?" }));
    expect(events.some((e) => e.event === "tool-start" && (e.data as { name: string }).name === "overview")).toBe(true);
    expect(events.some((e) => e.event === "tool-end")).toBe(true);
    expect(events[events.length - 1]!.event).toBe("done");
  });

  it("broadcasts state-changed after an APPROVED turn that writes state so the UI reloads", async () => {
    const { app, broadcasts } = setup({
      chatTurns: [
        [{ type: "turn_end", stopReason: "tool_use", content: [{ type: "tool_use", id: "g1", name: "set_glossary_term", input: { term: "Sprout", doNotTranslate: true } }] }],
        [{ type: "text", delta: "Added Sprout to the glossary." }, { type: "turn_end", stopReason: "end_turn", content: [{ type: "text", text: "Added Sprout to the glossary." }] }],
      ],
    });
    // The write tool is confirm-gated, so approve the batch mid-stream.
    const events = await collectSSEAnswering(await post(app, "/chat/stream", { message: "add Sprout to the glossary" }), app, true);
    expect(events.some((e) => e.event === "confirm-required")).toBe(true);
    // The tool persisted the change to disk...
    const state = await (await app.request("/state")).json();
    expect(state.glossary.some((g: { term: string }) => g.term === "Sprout")).toBe(true);
    // ...and the UI was told to reload it.
    expect(broadcasts).toContain("state-changed");
  });

  it("a SKIPPED write turn leaves state untouched and broadcasts nothing", async () => {
    const { app, broadcasts } = setup({
      chatTurns: [
        [{ type: "turn_end", stopReason: "tool_use", content: [{ type: "tool_use", id: "g1", name: "set_glossary_term", input: { term: "Sprout", doNotTranslate: true } }] }],
        [{ type: "text", delta: "Okay, left it." }, { type: "turn_end", stopReason: "end_turn", content: [{ type: "text", text: "Okay, left it." }] }],
      ],
    });
    const events = await collectSSEAnswering(await post(app, "/chat/stream", { message: "add Sprout to the glossary" }), app, false);
    expect(events.some((e) => e.event === "confirm-required")).toBe(true);
    expect(events[events.length - 1]!.event).toBe("done");
    const state = await (await app.request("/state")).json();
    expect(state.glossary.some((g: { term: string }) => g.term === "Sprout")).toBe(false);
    expect(broadcasts).not.toContain("state-changed");
  });

  it("does not broadcast state-changed for a read-only turn", async () => {
    const { app, broadcasts } = setup({
      chatTurns: [
        [{ type: "turn_end", stopReason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "overview", input: {} }] }],
        [{ type: "text", delta: "You have 1 key." }, { type: "turn_end", stopReason: "end_turn", content: [{ type: "text", text: "You have 1 key." }] }],
      ],
    });
    await collectSSE(await post(app, "/chat/stream", { message: "how many keys?" }));
    expect(broadcasts).not.toContain("state-changed");
  });

  it("errors clearly when the provider can't chat", async () => {
    const { app } = setup({ chat: false });
    const events = await collectSSE(await post(app, "/chat/stream", { message: "hi" }));
    expect(events.some((e) => e.event === "error" && /Anthropic/.test((e.data as { error: string }).error))).toBe(true);
  });

  it("POST /chat/confirm returns 404 when nothing is pending", async () => {
    const { app } = setup();
    const res = await post(app, "/chat/confirm", { batchId: "nope", approved: true });
    expect(res.status).toBe(404);
  });
});
