import { setMetadata, addNote, setTargetValue, setKeyState, canonLocale } from "../../state.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

// Per-key writes: the string-level guidance and fixes the assistant can make.
// All single, reversible edits, so no confirm gate (the conversational
// propose-then-wait covers approval). Each loads, mutates, persists the WHOLE
// state.

const setKeyContext: ChatTool = {
  def: {
    name: "set_key_context",
    strict: true,
    description: "Set the human context note for ONE key — what the string means, where it appears, and anything a translator needs to disambiguate it (e.g. button vs. heading, who the subject is). This is the single biggest per-string quality lever. Pass empty text to clear it. Writing context marks it human-authored.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The key path (e.g. \"plant.feed\")." },
        context: { type: "string", description: "The context prose. Empty clears it." },
      },
      required: ["key", "context"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `set context for ${(input as { key?: string }).key ?? ""}`,
  run: async (input, ctx: ToolContext) => {
    const { key, context } = input as { key: string; context: string };
    const s = ctx.load();
    setMetadata(s, key, { context: context.trim() });
    ctx.persist(s);
    return { ok: true, key, context: s.keys[key]?.context ?? "" };
  },
};

const addKeyNote: ChatTool = {
  def: {
    name: "add_key_note",
    strict: true,
    description: "Add a freeform note to a key — an observation, a question for the developer, or a translation decision worth recording. Notes accumulate; they don't replace each other.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        text: { type: "string" },
      },
      required: ["key", "text"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `note on ${(input as { key?: string }).key ?? ""}`,
  run: async (input, ctx: ToolContext) => {
    const { key, text } = input as { key: string; text: string };
    const s = ctx.load();
    const note = addNote(s, key, text.trim());
    ctx.persist(s);
    return { ok: true, key, noteId: note.id };
  },
};

const setTranslation: ChatTool = {
  def: {
    name: "set_translation",
    strict: true,
    description: "Set or fix ONE key's translation in one target locale, and mark it reviewed. Use to correct a specific bad string the user agreed on — NOT for bulk filling (use translate for that). Does not apply to plural keys.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        locale: { type: "string", description: "Target locale (BCP-47, e.g. \"de\")." },
        value: { type: "string", description: "The translated text." },
      },
      required: ["key", "locale", "value"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => {
    const i = input as { key?: string; locale?: string };
    return `set ${canonLocale(i.locale ?? "")} for ${i.key ?? ""}`;
  },
  run: async (input, ctx: ToolContext) => {
    const { key, locale, value } = input as { key: string; locale: string; value: string };
    const loc = canonLocale(locale);
    const s = ctx.load();
    setTargetValue(s, key, loc, value);
    ctx.persist(s);
    return { ok: true, key, locale: loc, value: value.trim(), state: "reviewed" };
  },
};

const setTranslationState: ChatTool = {
  def: {
    name: "set_translation_state",
    strict: true,
    description: "Change a translation's review state without changing its text: mark it reviewed (approved), needs-review (flag for a human), or machine. Use to approve a translation the user is happy with, or to flag one that looks off.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        locale: { type: "string", description: "Target locale (BCP-47)." },
        state: { type: "string", enum: ["reviewed", "needs-review", "machine"] },
      },
      required: ["key", "locale", "state"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => {
    const i = input as { key?: string; locale?: string; state?: string };
    return `mark ${i.key ?? ""} @ ${canonLocale(i.locale ?? "")} ${i.state ?? ""}`;
  },
  run: async (input, ctx: ToolContext) => {
    const { key, locale, state } = input as { key: string; locale: string; state: "reviewed" | "needs-review" | "machine" };
    const loc = canonLocale(locale);
    const s = ctx.load();
    setKeyState(s, key, loc, state);
    ctx.persist(s);
    return { ok: true, key, locale: loc, state };
  },
};

export const keyWriteTools: ChatTool[] = [setKeyContext, addKeyNote, setTranslation, setTranslationState];
