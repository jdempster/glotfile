import type { ChatTool } from "../chat-types.js";
import { stateReadTools } from "./read-state.js";
import { codebaseTools } from "./read-codebase.js";
import { usageReadTools } from "./read-usage.js";
import { guidanceWriteTools } from "./write-guidance.js";
import { glossaryWriteTools } from "./glossary.js";
import { keyWriteTools } from "./write-keys.js";
import { viewTools } from "./view.js";
import { lintTools } from "./lint.js";
import { retranslateTools } from "./retranslate.js";

// The tools the assistant may call: read the project state, read the user's
// codebase (incl. where each key is used), drive the editor's view (filter the
// key list, open a key), run the catalog's lint checks, read the lint config, and manage the rules that
// silence noise (ignore globs, per-locale severities, per-key dismissals), and
// make FOCUSED, single-item changes to the SETUP that steers translation —
// project/locale guidance, adding a target language, glossary terms, per-key
// context/tags/length, and source text. Lingo never AUTHORS a translation and
// never re-marks review states — but it may aim the app's own translation
// pipeline at specific broken cells via retranslate (approval-gated), e.g. to
// repair lint findings in bulk without the user hand-editing each one. It has
// no access to the human Notes field.
export function buildToolRegistry(): ChatTool[] {
  return [...stateReadTools, ...codebaseTools, ...usageReadTools, ...guidanceWriteTools, ...glossaryWriteTools, ...keyWriteTools, ...viewTools, ...lintTools, ...retranslateTools];
}
