import type { ChatProvider } from "./provider.js";
import type {
  ChatMessage, ChatContentBlock, ChatStreamEvent, ChatTool, ToolContext,
} from "./chat-types.js";

export interface ChatTurnDeps {
  provider: ChatProvider;
  tools: ChatTool[];
  ctx: ToolContext;
  // The stable, cacheable system prompt (persona + rules).
  system: string;
  // The volatile per-turn project snapshot, sent after the cache breakpoint.
  context?: string;
  // Emit a progress event to the caller (forwarded over SSE to the UI).
  onEvent(event: ChatStreamEvent): void;
  // Resolve whether a confirm-gated tool may run. The caller (API) wires this to
  // the UI's Apply/Skip card via /chat/confirm.
  confirm(req: { toolUseId: string; name: string; input: unknown; humanSummary: string }): Promise<boolean>;
  signal?: AbortSignal;
}

// Hard cap on tool-loop iterations — a backstop against a model that never stops
// calling tools. Far above any real conversation turn.
const MAX_ITERATIONS = 16;

// Drive one user message to completion: call the provider for a turn, run any
// requested tools (gating confirm tools), feed results back, and repeat until
// the model answers with no tool calls. Returns the full updated history
// (including the new user message and every assistant/tool message) for the
// caller to persist.
export async function runChatTurn(history: ChatMessage[], userText: string, deps: ChatTurnDeps): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [...history, { role: "user", content: [{ type: "text", text: userText }] }];
  const toolDefs = deps.tools.map((t) => t.def);
  const byName = new Map(deps.tools.map((t) => [t.def.name, t]));

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (deps.signal?.aborted) return messages;

      // --- one model turn ---
      // text events stream live to the UI; turn_end carries the authoritative
      // assistant content (thinking + text + tool_use) to persist and act on.
      let assistantContent: ChatContentBlock[] = [];
      let stopReason = "end_turn";
      for await (const ev of deps.provider.chat(messages, toolDefs, deps.system, deps.signal, deps.context)) {
        if (ev.type === "text") {
          if (ev.delta) deps.onEvent({ type: "text", delta: ev.delta });
        } else if (ev.type === "turn_end") {
          assistantContent = ev.content;
          stopReason = ev.stopReason;
        }
      }
      messages.push({ role: "assistant", content: assistantContent });

      const toolUses = assistantContent.filter((b): b is Extract<ChatContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      if (toolUses.length === 0) {
        // A safety refusal returns no text and no tools — surface a line so the
        // turn doesn't render as an empty bubble.
        if (stopReason === "refusal" && !assistantContent.some((b) => b.type === "text" && b.text.trim())) {
          deps.onEvent({ type: "text", delta: "I'm sorry — I can't help with that request." });
        }
        deps.onEvent({ type: "done" });
        return messages;
      }

      // --- run each requested tool, gating confirm tools ---
      const results: ChatContentBlock[] = [];
      for (const call of toolUses) {
        const tool = byName.get(call.name);
        if (!tool) {
          results.push({ type: "tool_result", toolUseId: call.id, content: `Unknown tool "${call.name}".`, isError: true });
          continue;
        }
        const humanSummary = safeSummary(tool, call.input);

        if (tool.confirm) {
          deps.onEvent({ type: "confirm-required", id: call.id, name: call.name, humanSummary, input: call.input });
          const approved = await deps.confirm({ toolUseId: call.id, name: call.name, input: call.input, humanSummary });
          if (!approved) {
            deps.onEvent({ type: "tool-end", id: call.id, result: { declined: true } });
            results.push({ type: "tool_result", toolUseId: call.id, content: "The user declined to run this action.", isError: false });
            continue;
          }
        }

        deps.onEvent({ type: "tool-start", id: call.id, name: call.name, humanSummary });
        try {
          const result = await tool.run(call.input, deps.ctx);
          deps.onEvent({ type: "tool-end", id: call.id, result });
          results.push({ type: "tool_result", toolUseId: call.id, content: JSON.stringify(result ?? null) });
        } catch (e) {
          const error = (e as Error).message ?? String(e);
          deps.onEvent({ type: "tool-end", id: call.id, error });
          results.push({ type: "tool_result", toolUseId: call.id, content: `Error: ${error}`, isError: true });
        }
      }
      messages.push({ role: "user", content: results });
    }

    deps.onEvent({ type: "error", error: "Reached the tool-iteration limit without a final answer." });
    return messages;
  } catch (e) {
    if (deps.signal?.aborted) return messages;
    deps.onEvent({ type: "error", error: (e as Error).message ?? String(e) });
    return messages;
  }
}

// humanSummary is author-supplied; never let a bad summary fn abort the turn.
function safeSummary(tool: ChatTool, input: unknown): string {
  try { return tool.humanSummary(input); } catch { return tool.def.name; }
}
