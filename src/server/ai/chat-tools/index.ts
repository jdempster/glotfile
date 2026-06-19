import type { ChatTool } from "../chat-types.js";
import { stateReadTools } from "./read-state.js";
import { codebaseTools } from "./read-codebase.js";
import { guidanceWriteTools } from "./write-guidance.js";

// The tools the assistant may call. Phase 1: read the project state, read the
// user's codebase, and author guidance. Phase 2 appends glossary, context, and
// translation-action tools.
export function buildToolRegistry(): ChatTool[] {
  return [...stateReadTools, ...codebaseTools, ...guidanceWriteTools];
}
