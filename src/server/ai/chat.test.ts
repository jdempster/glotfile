import { describe, it, expect } from "vitest";
import { runChatTurn } from "./chat.js";
import { buildToolRegistry } from "./chat-tools/index.js";
import { defaultState, type State } from "../schema.js";
import type { ChatProvider } from "./provider.js";
import type { ChatEvent, ChatTool, ChatStreamEvent, ToolContext } from "./chat-types.js";

function sproutState(): State {
  const s = defaultState();
  s.config.locales = ["en", "de"];
  s.keys = {
    "plant.water": { values: { en: { value: "Water your plant", state: "source" } } },
    "plant.feed": { values: { en: { value: "Feed your plant", state: "source" } } },
  };
  return s;
}

// A ChatProvider whose chat() replays a scripted list of event sequences, one
// per call (turn). Other TranslationProvider methods are unused stubs.
function scriptedProvider(turns: ChatEvent[][]): ChatProvider {
  let i = 0;
  return {
    supportsVision: () => false,
    translate: async () => [],
    complete: async () => ({}),
    async *chat() {
      const t = turns[i++] ?? [{ type: "turn_end", stopReason: "end_turn" }];
      for (const e of t) yield e;
    },
  } as unknown as ChatProvider;
}

const ctxFor = (provider: ChatProvider, state: State): ToolContext =>
  ({ projectRoot: "/x", statePath: "", load: () => state, persist: () => {}, provider });

describe("runChatTurn", () => {
  it("runs a tool, feeds the result back, and returns the full turn history", async () => {
    const provider = scriptedProvider([
      [{ type: "tool_use", id: "t1", name: "overview", input: {} }, { type: "turn_end", stopReason: "tool_use" }],
      [{ type: "text", delta: "Sprout has 2 keys." }, { type: "turn_end", stopReason: "end_turn" }],
    ]);
    const state = sproutState();
    const events: ChatStreamEvent[] = [];
    const history = await runChatTurn([], "how many keys?", {
      provider, tools: buildToolRegistry(), ctx: ctxFor(provider, state), system: "sys",
      onEvent: (e) => events.push(e), confirm: async () => true,
    });

    const types = events.map((e) => e.type);
    expect(types).toContain("tool-start");
    expect(types).toContain("tool-end");
    expect(events.some((e) => e.type === "text" && e.delta.includes("Sprout"))).toBe(true);
    expect(types[types.length - 1]).toBe("done");

    expect(history).toHaveLength(4);
    expect(history[0]).toMatchObject({ role: "user" });
    expect(history[1]!.content[0]).toMatchObject({ type: "tool_use", name: "overview" });
    expect(history[2]!.content[0]!.type).toBe("tool_result");
    expect(history[3]!.content.some((b) => b.type === "text")).toBe(true);
  });

  it("gates a confirm tool: declining skips the run and feeds a declined result", async () => {
    let ran = false;
    const danger: ChatTool = {
      def: { name: "danger", description: "destructive", schema: { type: "object" } },
      confirm: true,
      humanSummary: () => "do the dangerous thing",
      run: async () => { ran = true; return { ok: true }; },
    };
    const provider = scriptedProvider([
      [{ type: "tool_use", id: "t1", name: "danger", input: {} }, { type: "turn_end", stopReason: "tool_use" }],
      [{ type: "text", delta: "Okay, skipped." }, { type: "turn_end", stopReason: "end_turn" }],
    ]);
    const state = sproutState();
    const events: ChatStreamEvent[] = [];
    const history = await runChatTurn([], "do it", {
      provider, tools: [danger], ctx: ctxFor(provider, state), system: "sys",
      onEvent: (e) => events.push(e), confirm: async () => false,
    });

    expect(events.some((e) => e.type === "confirm-required")).toBe(true);
    expect(ran).toBe(false);
    const result = history[2]!.content[0]!;
    expect(result.type).toBe("tool_result");
    expect(result.type === "tool_result" && result.content.toLowerCase()).toContain("declin");
  });

  it("gates a confirm tool: approving runs it", async () => {
    let ran = false;
    const danger: ChatTool = {
      def: { name: "danger", description: "destructive", schema: { type: "object" } },
      confirm: true,
      humanSummary: () => "do the dangerous thing",
      run: async () => { ran = true; return { ok: true }; },
    };
    const provider = scriptedProvider([
      [{ type: "tool_use", id: "t1", name: "danger", input: {} }, { type: "turn_end", stopReason: "tool_use" }],
      [{ type: "text", delta: "Done." }, { type: "turn_end", stopReason: "end_turn" }],
    ]);
    const state = sproutState();
    const events: ChatStreamEvent[] = [];
    await runChatTurn([], "do it", {
      provider, tools: [danger], ctx: ctxFor(provider, state), system: "sys",
      onEvent: (e) => events.push(e), confirm: async () => true,
    });
    expect(ran).toBe(true);
    expect(events.some((e) => e.type === "tool-start")).toBe(true);
  });

  it("an unknown tool yields an error result rather than throwing", async () => {
    const provider = scriptedProvider([
      [{ type: "tool_use", id: "t1", name: "nope", input: {} }, { type: "turn_end", stopReason: "tool_use" }],
      [{ type: "text", delta: "Sorry." }, { type: "turn_end", stopReason: "end_turn" }],
    ]);
    const state = sproutState();
    const history = await runChatTurn([], "x", {
      provider, tools: buildToolRegistry(), ctx: ctxFor(provider, state), system: "sys",
      onEvent: () => {}, confirm: async () => true,
    });
    const result = history[2]!.content[0]!;
    expect(result.type === "tool_result" && result.isError).toBe(true);
  });
});
