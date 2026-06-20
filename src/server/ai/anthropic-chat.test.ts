import { describe, it, expect } from "vitest";
import { AnthropicProvider } from "./anthropic.js";
import type { AiConfig } from "../schema.js";
import type { ChatEvent } from "./chat-types.js";

const cfg: AiConfig = { provider: "anthropic", model: "claude-test", endpoint: null, batchSize: 25 };

interface CannedMessage { content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>; stop_reason: string; usage: unknown }

// A fake MessagesClient.stream that streams text deltas for each text block, then
// returns the canned message as finalMessage(). Records the args per call so we
// can assert the message/tool/system mapping.
function fakeClient(turns: CannedMessage[]) {
  const calls: { messages: { role: string; content: unknown[] }[]; tools: unknown[]; system: unknown }[] = [];
  let i = 0;
  return {
    calls,
    client: {
      messages: {
        stream: (args: unknown) => {
          calls.push(args as (typeof calls)[number]);
          const msg = turns[i++]!;
          return {
            async *[Symbol.asyncIterator]() {
              for (const b of msg.content) {
                if (b.type === "text") yield { type: "content_block_delta", delta: { type: "text_delta", text: b.text } };
              }
            },
            finalMessage: async () => msg,
          };
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

// A step is either a canned successful turn or an error thrown while opening the
// stream (how a grammar-compilation timeout surfaces — before any output).
type Step = CannedMessage | { throws: Error };

function fakeClientSteps(steps: Step[]) {
  const calls: { tools?: { strict?: boolean }[] }[] = [];
  let i = 0;
  return {
    calls,
    client: {
      messages: {
        stream: (args: unknown) => {
          calls.push(args as (typeof calls)[number]);
          const step = steps[i++]!;
          return {
            async *[Symbol.asyncIterator]() {
              if ("throws" in step) throw step.throws;
              for (const b of step.content) {
                if (b.type === "text") yield { type: "content_block_delta", delta: { type: "text_delta", text: b.text } };
              }
            },
            finalMessage: async () => {
              if ("throws" in step) throw step.throws;
              return step;
            },
          };
        },
      },
    },
  };
}

const strictTool = { name: "set_key_context", description: "d", schema: { type: "object" as const }, strict: true };
const okTurn: CannedMessage = { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: {} };

describe("AnthropicProvider.chat", () => {
  it("emits turn_end carrying the tool_use content for a tool-use turn", async () => {
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
      { type: "turn_end", stopReason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "overview", input: { foo: 1 } }] },
    ]);
  });

  it("streams text deltas then turn_end for a text-only turn, and records usage", async () => {
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
      { type: "turn_end", stopReason: "end_turn", content: [{ type: "text", text: "Sprout has 3 keys." }] },
    ]);
    expect(p.takeUsage()).toMatchObject({ inputTokens: 10, outputTokens: 4 });
  });

  it("sends the stable system prompt and the volatile snapshot as separate blocks", async () => {
    const fake = fakeClient([
      { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: {} },
    ]);
    const p = new AnthropicProvider(cfg, fake.client as never);
    await collect(
      p,
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      [],
      "STABLE",
      undefined,
      "SNAPSHOT",
    );
    const sys = (fake.calls[0]!.system) as Array<{ text: string; cache_control?: unknown }>;
    expect(sys[0]).toMatchObject({ text: "STABLE", cache_control: { type: "ephemeral" } });
    expect(sys[1]).toMatchObject({ text: "SNAPSHOT" });
    expect(sys[1]!.cache_control).toBeUndefined();
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

  // The API compiles strict tool schemas into a constrained-decoding grammar and
  // can transiently return "Grammar compilation timed out" on a cold compile. The
  // turn must recover rather than die.
  it("retries a transient grammar-compilation timeout, keeping strict, and recovers", async () => {
    const fake = fakeClientSteps([{ throws: new Error("Grammar compilation timed out") }, okTurn]);
    const p = new AnthropicProvider(cfg, fake.client as never);
    const events = await collect(p, [{ role: "user", content: [{ type: "text", text: "hi" }] }], [strictTool], "sys");
    expect(events).toEqual([
      { type: "retry", attempt: 1, total: 3 },
      { type: "text", delta: "ok" },
      { type: "turn_end", stopReason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    expect(fake.calls).toHaveLength(2);
    // Both attempts keep strict — the retry banks on the now-warm schema cache.
    expect(fake.calls[0]!.tools![0]).toMatchObject({ strict: true });
    expect(fake.calls[1]!.tools![0]).toMatchObject({ strict: true });
  });

  it("drops strict as a last resort so the turn still completes", async () => {
    const fake = fakeClientSteps([
      { throws: new Error("Grammar compilation timed out") },
      { throws: new Error("Grammar compilation timed out") },
      okTurn,
    ]);
    const p = new AnthropicProvider(cfg, fake.client as never);
    const events = await collect(p, [{ role: "user", content: [{ type: "text", text: "hi" }] }], [strictTool], "sys");
    expect(events).toEqual([
      { type: "retry", attempt: 1, total: 3 },
      { type: "retry", attempt: 2, total: 3 },
      { type: "text", delta: "ok" },
      { type: "turn_end", stopReason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[1]!.tools![0]).toMatchObject({ strict: true });
    // Final fallback advertises the tool without strict — no grammar to compile.
    expect(fake.calls[2]!.tools![0]).not.toHaveProperty("strict");
  });

  it("does not retry errors that are not grammar-compilation timeouts", async () => {
    const fake = fakeClientSteps([{ throws: new Error("overloaded_error") }, okTurn]);
    const p = new AnthropicProvider(cfg, fake.client as never);
    await expect(collect(p, [{ role: "user", content: [{ type: "text", text: "hi" }] }], [strictTool], "sys")).rejects.toThrow("overloaded_error");
    expect(fake.calls).toHaveLength(1);
  });
});
