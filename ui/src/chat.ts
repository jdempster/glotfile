import { ref } from "vue";
import { chatStream, getChat, clearChat as apiClearChat, confirmChatTool, getLocalSettings } from "./api";
import { drillTo, selectKey } from "./drilldown";
import type { ChatStreamEvent, ChatMessage } from "./types";
import type { KeyFilter } from "./filter";

// UI-side message model. Distinct from the persisted transcript: it carries the
// rendered text plus a row per tool call with its live status, so the panel can
// show "🔎 search … → 12 keys" and Apply/Skip cards as a turn streams in.
export type ToolStatus = "running" | "done" | "error" | "declined" | "pending-confirm";
export interface UiToolCall {
  id: string;
  name: string;
  humanSummary: string;
  status: ToolStatus;
  input?: unknown;
  result?: unknown;
  error?: string;
  progress?: { done: number; total: number; detail?: string };
}
export interface UiMessage {
  role: "user" | "assistant";
  text: string;
  tools: UiToolCall[];
  error?: string;
}

// --- pure reducer (unit-tested) ---

function currentAssistant(messages: UiMessage[]): UiMessage {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant") return last;
  const msg: UiMessage = { role: "assistant", text: "", tools: [] };
  messages.push(msg);
  return msg;
}

function upsertTool(msg: UiMessage, id: string, patch: Partial<UiToolCall> & { name?: string; humanSummary?: string }): UiToolCall {
  let tool = msg.tools.find((t) => t.id === id);
  if (!tool) {
    tool = { id, name: patch.name ?? "", humanSummary: patch.humanSummary ?? "", status: "running" };
    msg.tools.push(tool);
  }
  Object.assign(tool, patch);
  return tool;
}

// Fold one streamed event into the message list, mutating in place.
export function applyEvent(messages: UiMessage[], event: ChatStreamEvent): void {
  // A turn boundary starts a fresh assistant bubble so each agentic turn renders
  // on its own — without this the live view merges every turn into one bubble,
  // diverging from the per-turn split the transcript shows on reload.
  if (event.type === "turn-start") {
    messages.push({ role: "assistant", text: "", tools: [] });
    return;
  }
  const msg = currentAssistant(messages);
  switch (event.type) {
    case "text":
      msg.text += event.delta;
      break;
    case "tool-start":
      upsertTool(msg, event.id, { name: event.name, humanSummary: event.humanSummary, status: "running" });
      break;
    case "tool-progress":
      upsertTool(msg, event.id, { progress: { done: event.done, total: event.total, detail: event.detail } });
      break;
    case "tool-end":
      upsertTool(msg, event.id, event.error ? { status: "error", error: event.error } : { status: "done", result: event.result });
      break;
    case "confirm-required":
      upsertTool(msg, event.id, { name: event.name, humanSummary: event.humanSummary, status: "pending-confirm", input: event.input });
      break;
    case "error":
      msg.error = event.error;
      break;
    case "done":
      break;
  }
}

// The `filter_view` tool changes what the editor shows rather than the project
// state, so its effect lives outside the message reducer: this reads the partial
// filter it returned (null for any other event) and send() hands it to the editor
// via the drilldown channel. Skipped on transcript reload, so reopening the panel
// never re-filters the list.
export function viewFilterFromEvent(event: ChatStreamEvent): Partial<KeyFilter> | null {
  if (event.type !== "tool-end" || event.error) return null;
  const result = event.result;
  if (!result || typeof result !== "object") return null;
  const vf = (result as { viewFilter?: unknown }).viewFilter;
  if (!vf || typeof vf !== "object") return null;
  return vf as Partial<KeyFilter>;
}

// The `select_key` tool opens a key's detail panel; like viewFilter this effect
// lives outside the reducer. Returns the key to open, or null for any other event.
export function selectKeyFromEvent(event: ChatStreamEvent): string | null {
  if (event.type !== "tool-end" || event.error) return null;
  const result = event.result;
  if (!result || typeof result !== "object") return null;
  const k = (result as { selectKey?: unknown }).selectKey;
  return typeof k === "string" ? k : null;
}

// Rebuild the UI message list from a persisted transcript (on reload). tool_use
// blocks become tool rows; the following user message's tool_result blocks
// resolve them by id.
export function transcriptToUi(messages: ChatMessage[]): UiMessage[] {
  const out: UiMessage[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      const ui: UiMessage = { role: "assistant", text: "", tools: [] };
      for (const b of m.content) {
        if (b.type === "text") ui.text += b.text;
        else if (b.type === "tool_use") ui.tools.push({ id: b.id, name: b.name, humanSummary: b.name, status: "done", input: b.input });
      }
      out.push(ui);
    } else {
      const textBlocks = m.content.filter((b) => b.type === "text") as Extract<ChatMessage["content"][number], { type: "text" }>[];
      const results = m.content.filter((b) => b.type === "tool_result") as Extract<ChatMessage["content"][number], { type: "tool_result" }>[];
      // tool_result blocks resolve tool rows on the preceding assistant message.
      for (const r of results) {
        for (let i = out.length - 1; i >= 0; i--) {
          const tool = out[i]!.tools.find((t) => t.id === r.toolUseId);
          if (tool) { tool.status = r.isError ? "error" : "done"; tool.result = r.content; break; }
        }
      }
      if (textBlocks.length) out.push({ role: "user", text: textBlocks.map((b) => b.text).join(""), tools: [] });
    }
  }
  return out;
}

// --- reactive store ---

export const messages = ref<UiMessage[]>([]);
export const isOpen = ref(false);     // panel visibility
export const expanded = ref(false);   // expanded (over-content) vs docked side column
export const isSending = ref(false);
export const loaded = ref(false);
// The chat backend is Anthropic-only, so the whole feature (toggle + panel) is
// hidden unless the active provider is Anthropic.
export const available = ref(false);
// Bumped to ask the composer to focus its input (on open or via the hotkey).
export const focusNonce = ref(0);
export function focusInput(): void { focusNonce.value++; }
// Whether the composer input currently holds focus — lets Cmd/Ctrl+J hide the
// panel when you're already typing in it.
export const inputFocused = ref(false);
// The key currently open in the editor's detail panel (null when none / not on
// the editor). Sent with each turn so Lingo can resolve "this key"/"this string".
export const activeKey = ref<string | null>(null);
let controller: AbortController | null = null;

// Refresh chat availability from the effective AI provider (resolves the active
// profile server-side). Closes the panel if the feature became unavailable.
export async function refreshAvailability(): Promise<void> {
  try {
    const ls = await getLocalSettings();
    available.value = ls.ai?.provider === "anthropic";
  } catch {
    available.value = false;
  }
  if (!available.value) isOpen.value = false;
}

export async function loadHistory(): Promise<void> {
  try {
    const transcript = await getChat();
    messages.value = transcriptToUi(transcript.messages);
  } catch {
    // A fresh project (or unreachable server) just starts empty.
    messages.value = [];
  }
  loaded.value = true;
}

export async function send(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || isSending.value) return;
  messages.value.push({ role: "user", text: trimmed, tools: [] });
  isSending.value = true;
  controller = new AbortController();
  try {
    for await (const event of chatStream(trimmed, controller.signal, activeKey.value)) {
      applyEvent(messages.value, event);
      // When Lingo filters the list or opens a key, drive the editor (navigating
      // there if the user is elsewhere) so they see what it's talking about.
      const vf = viewFilterFromEvent(event);
      if (vf) drillTo(vf);
      const sk = selectKeyFromEvent(event);
      if (sk) selectKey(sk);
    }
  } catch (e) {
    applyEvent(messages.value, { type: "error", error: (e as Error).message });
  } finally {
    isSending.value = false;
    controller = null;
  }
}

export function cancel(): void {
  controller?.abort();
  isSending.value = false;
}

export async function respondConfirm(toolUseId: string, approved: boolean): Promise<void> {
  // Optimistically reflect the choice on the tool row; the ensuing
  // tool-start/tool-end events refine it.
  for (const m of messages.value) {
    const tool = m.tools.find((t) => t.id === toolUseId);
    if (tool && tool.status === "pending-confirm") tool.status = approved ? "running" : "declined";
  }
  await confirmChatTool(toolUseId, approved);
}

export function open(): void { isOpen.value = true; }
export function toggleOpen(): void {
  // Leave `expanded` as-is so reopening restores the last docked/expanded state.
  isOpen.value = !isOpen.value;
  // The composer unmounts on close without a reliable blur — clear the flag.
  if (!isOpen.value) inputFocused.value = false;
}
export function toggleExpanded(): void { expanded.value = !expanded.value; }

export async function clear(): Promise<void> {
  await apiClearChat();
  messages.value = [];
}
