import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "./api.js";
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
  return { dir, file, app: createApi({ statePath: file, makeProvider: () => provider as never }) };
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

  it("errors clearly when the provider can't chat", async () => {
    const { app } = setup({ chat: false });
    const events = await collectSSE(await post(app, "/chat/stream", { message: "hi" }));
    expect(events.some((e) => e.event === "error" && /Anthropic/.test((e.data as { error: string }).error))).toBe(true);
  });

  it("POST /chat/confirm returns 404 when nothing is pending", async () => {
    const { app } = setup();
    const res = await post(app, "/chat/confirm", { toolUseId: "nope", approved: true });
    expect(res.status).toBe(404);
  });
});
