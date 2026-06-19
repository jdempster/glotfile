import type { State } from "../schema.js";
import type { ChatProvider } from "./provider.js";

// The conversational data model shared by the orchestrator, the Anthropic
// chat() implementation, and the persisted transcript. Deliberately
// provider-agnostic: anthropic.ts maps these to/from the Messages API shape.

export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ChatContentBlock[];
}

// A tool advertised to the model. `schema` is a JSON Schema for the input.
export interface ToolDef {
  name: string;
  description: string;
  schema: object;
}

// One unit of progress yielded by a provider's chat() for a SINGLE model turn.
// The orchestrator loops over turns; the provider does not loop internally.
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "turn_end"; stopReason: string };

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
  | { type: "text"; delta: string }
  | { type: "tool-start"; id: string; name: string; humanSummary: string }
  | { type: "tool-end"; id: string; result?: unknown; error?: string }
  | { type: "tool-progress"; id: string; done: number; total: number; detail?: string }
  | { type: "confirm-required"; id: string; name: string; humanSummary: string; input: unknown }
  | { type: "done" }
  | { type: "error"; error: string };
