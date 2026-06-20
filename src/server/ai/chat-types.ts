import type { State } from "../schema.js";
import type { ChatProvider } from "./provider.js";

// The conversational data model shared by the orchestrator, the Anthropic
// chat() implementation, and the persisted transcript. Deliberately
// provider-agnostic: anthropic.ts maps these to/from the Messages API shape.

export type ChatContentBlock =
  | { type: "text"; text: string }
  // Extended-thinking blocks. Preserved verbatim (signature included) and replayed
  // on the next turn — the Messages API rejects a modified thinking block, and a
  // tool-use turn that thought must carry its thinking back. `display: "omitted"`
  // (the default on current models) leaves `thinking` empty but the signature must
  // still round-trip.
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ChatContentBlock[];
}

// A tool advertised to the model. `schema` is a JSON Schema for the input.
// `strict: true` makes the API guarantee `tool_use.input` validates against the
// schema exactly — only valid for fully-closed schemas (additionalProperties:false,
// all properties required, no open maps).
export interface ToolDef {
  name: string;
  description: string;
  schema: object;
  strict?: boolean;
}

// What a provider's chat() yields for a SINGLE model turn. `text` events stream
// the assistant's reply token-by-token for live display only. `turn_end` carries
// the AUTHORITATIVE, fully-assembled assistant content (thinking + text + tool_use
// in order) for the orchestrator to persist and to drive tool execution — so the
// transcript reflects exactly what the model produced, not a delta reconstruction.
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "turn_end"; stopReason: string; content: ChatContentBlock[] };

// What a tool needs to do its work. `load` re-reads the current State from disk
// (so user edits made mid-conversation are not clobbered); `persist` writes it
// back. `provider` lets action tools (translate/context) run sub-passes.
export interface ToolContext {
  projectRoot: string;
  statePath: string;
  load(): State;
  persist(state: State): void;
  provider: ChatProvider;
  signal?: AbortSignal;
}

// A registered tool: its advertised definition, whether it must be confirmed
// before running (destructive/bulk/expensive ops), a one-line human summary for
// the UI action row + confirm card, and the executor.
export interface ChatTool {
  def: ToolDef;
  confirm?: boolean;
  humanSummary(input: unknown): string;
  run(input: unknown, ctx: ToolContext): Promise<unknown>;
}

// The server→UI event stream (a superset of ChatEvent): the orchestrator emits
// these over SSE so the UI can render streaming text, tool action rows, and the
// confirm prompt for gated tools.
export type ChatStreamEvent =
  // Start of an agentic turn — the UI opens a fresh assistant bubble so each turn
  // renders separately, matching how the reloaded transcript splits per turn.
  | { type: "turn-start" }
  | { type: "text"; delta: string }
  | { type: "tool-start"; id: string; name: string; humanSummary: string }
  | { type: "tool-end"; id: string; result?: unknown; error?: string }
  | { type: "tool-progress"; id: string; done: number; total: number; detail?: string }
  // A batch of confirm-gated edits awaiting ONE approval (the UI's Approve/Skip
  // card). batchId resolves the whole batch via /chat/confirm; items are the
  // pending edit rows to render.
  | { type: "confirm-required"; batchId: string; items: { id: string; name: string; humanSummary: string; input: unknown }[] }
  | { type: "done" }
  | { type: "error"; error: string };
