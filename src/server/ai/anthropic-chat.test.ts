import { describe, it, expect } from "vitest";
import { AnthropicProvider } from "./anthropic.js";
import type { AiConfig } from "../schema.js";
import type { ChatEvent } from "./chat-types.js";

const cfg: AiConfig = { provider: "anthropic", model: "claude-test", endpoint: null, batchSize: 25 };

// A fake MessagesClient.create that returns canned turns in order and records
// the args it was called with (so we can assert the message/tool mapping).
function fakeClient(turns: unknown[]) {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    client: {
      messages: {
        create: async (args: unknown) => {
          calls.push(args);
          return turns[i++];
        },
      },
    },
  };
}

async function collect(p: AnthropicProvider, ...args: Parameters<AnthropicProvider["chat"]>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of p.chat(...args)) out.push(e);
  return out;
}

describe("AnthropicProvider.chat", () => {
  it("emits tool_use then turn_end for a tool-use turn", async () => {
    const { client } = fakeClient([
      { content: [{ type: "tool_use", id: "t1", name: "overview", input: { foo: 1 } }], stop_reason: "tool_use", usage: { input_tokens: 5, output_tokens: 3 } },
    ]);
    const p = new AnthropicProvider(cfg, client as never);
    const events = await collect(
      p,
      [{ role: "user", content: [{ type: "text", text: "how many keys?" }] }],
      [{ name: "overview", description: "Project overview", schema: { type: "object" } }],
      "system prompt",
    );
    expect(events).toEqual([
      { type: "tool_use", id: "t1", name: "overview", input: { foo: 1 } },
      { type: "turn_end", stopReason: "tool_use" },
    ]);
  });

  it("emits text then turn_end for a text-only turn, and records usage", async () => {
    const { client } = fakeClient([
      { content: [{ type: "text", text: "Sprout has 3 keys." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 4 } },
    ]);
    const p = new AnthropicProvider(cfg, client as never);
    const events = await collect(
      p,
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      [],
      "system",
    );
    expect(events).toEqual([
      { type: "text", delta: "Sprout has 3 keys." },
      { type: "turn_end", stopReason: "end_turn" },
    ]);
    expect(p.takeUsage()).toMatchObject({ inputTokens: 10, outputTokens: 4 });
  });

  it("maps tool_result blocks and tools into the Anthropic request shape", async () => {
    const fake = fakeClient([
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: {} },
    ]);
    const p = new AnthropicProvider(cfg, fake.client as never);
    await collect(
      p,
      [
        { role: "user", content: [{ type: "text", text: "go" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "overview", input: {} }] },
        { role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: "3 keys", isError: false }] },
      ],
      [{ name: "overview", description: "d", schema: { type: "object" } }],
      "sys",
    );
    const args = fake.calls[0] as { messages: { role: string; content: unknown[] }[]; tools: unknown[]; system: unknown };
    // tool_result mapped to Anthropic's tool_use_id / is_error keys
    expect(args.messages[2]!.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1", content: "3 keys", is_error: false });
    // assistant tool_use preserved
    expect(args.messages[1]!.content[0]).toMatchObject({ type: "tool_use", id: "t1", name: "overview" });
    // tools advertised with input_schema
    expect(args.tools[0]).toMatchObject({ name: "overview", description: "d", input_schema: { type: "object" } });
  });
});
