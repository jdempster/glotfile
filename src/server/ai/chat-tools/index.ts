import type { ChatTool } from "../chat-types.js";
import { stateReadTools } from "./read-state.js";
import { codebaseTools } from "./read-codebase.js";
import { usageReadTools } from "./read-usage.js";
import { guidanceWriteTools } from "./write-guidance.js";
import { glossaryWriteTools } from "./glossary.js";
import { keyWriteTools } from "./write-keys.js";

// The tools the assistant may call: read the project state, read the user's
// codebase (incl. where each key is used), and make FOCUSED, single-item changes
// — project/locale guidance, glossary terms, per-key context/notes, and
// individual translation fixes. Deliberately NO bulk action (mass
// translate/review): Lingo suggests those and the user runs them from the app's
// own controls.
export function buildToolRegistry(): ChatTool[] {
  return [...stateReadTools, ...codebaseTools, ...usageReadTools, ...guidanceWriteTools, ...glossaryWriteTools, ...keyWriteTools];
}
