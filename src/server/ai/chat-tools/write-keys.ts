import { setMetadata, addNote, setTargetValue, setKeyState, setSourceValue, createKey, canonLocale } from "../../state.js";
import { glossaryViolations } from "../../glossary.js";
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
    description: "Set or fix ONE key's translation in one target locale, and mark it reviewed. Use to correct a specific bad string the user agreed on — NOT for bulk filling (use translate for that). If the locale is the source locale, this edits the source text instead and flags existing reviewed/machine translations needs-review (they may no longer match). Does not apply to plural keys.",
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
    // Writing the source locale is a source edit, not a translation: route it
    // through setSourceValue so the source keeps state `source` AND existing
    // reviewed/machine translations are flagged needs-review (they may no
    // longer match). setTargetValue would skip both — see the editor's same
    // routing in api.ts PUT /keys/:key/values/:locale.
    if (loc === s.config.sourceLocale) {
      setSourceValue(s, key, value);
      ctx.persist(s);
      return { ok: true, key, locale: loc, value: value.trim(), state: "source" };
    }
    setTargetValue(s, key, loc, value);
    ctx.persist(s);
    // Surface (don't block) glossary breaches: the user agreed to this string,
    // but a do-not-translate or forced term it ignored is worth flagging back so
    // the assistant can offer to fix it and keep terminology consistent.
    const source = s.keys[key]?.values[s.config.sourceLocale]?.value ?? "";
    const violations = source ? glossaryViolations(source, value, loc, s.glossary) : [];
    const result: Record<string, unknown> = { ok: true, key, locale: loc, value: value.trim(), state: "reviewed" };
    if (violations.length) {
      result.glossaryWarnings = violations.map((v) =>
        v.kind === "do-not-translate"
          ? `glossary: "${v.term}" should stay verbatim (keep "${v.expected}")`
          : `glossary: "${v.term}" should translate to "${v.expected}"`,
      );
    }
    return result;
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

const addKeyTag: ChatTool = {
  def: {
    name: "add_key_tag",
    strict: true,
    description: "Add a tag to ONE key. Tags group keys (e.g. \"onboarding\", \"cta\", \"legal\") so the user can filter by them. Idempotent — adding a tag the key already has is a no-op.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        tag: { type: "string", description: "A short label, e.g. \"cta\"." },
      },
      required: ["key", "tag"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => {
    const i = input as { key?: string; tag?: string };
    return `tag ${i.key ?? ""} #${i.tag ?? ""}`;
  },
  run: async (input, ctx: ToolContext) => {
    const { key, tag } = input as { key: string; tag: string };
    const t = tag.trim();
    if (!t) throw new Error("Tag cannot be empty.");
    const s = ctx.load();
    const current = s.keys[key]?.tags ?? [];
    setMetadata(s, key, { tags: current.includes(t) ? current : [...current, t] });
    ctx.persist(s);
    return { ok: true, key, tags: s.keys[key]?.tags ?? [] };
  },
};

const removeKeyTag: ChatTool = {
  def: {
    name: "remove_key_tag",
    strict: true,
    description: "Remove a tag from ONE key. A no-op if the key doesn't carry it.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        tag: { type: "string" },
      },
      required: ["key", "tag"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => {
    const i = input as { key?: string; tag?: string };
    return `untag ${i.key ?? ""} #${i.tag ?? ""}`;
  },
  run: async (input, ctx: ToolContext) => {
    const { key, tag } = input as { key: string; tag: string };
    const t = tag.trim();
    const s = ctx.load();
    const current = s.keys[key]?.tags ?? [];
    setMetadata(s, key, { tags: current.filter((x) => x !== t) });
    ctx.persist(s);
    return { ok: true, key, tags: s.keys[key]?.tags ?? [] };
  },
};

const setMaxLength: ChatTool = {
  def: {
    name: "set_max_length",
    strict: true,
    description: "Set a maximum character length for ONE key — a budget the translations should respect (e.g. a button or a fixed-width label). Pass 0 to clear the limit. It's advisory metadata surfaced to the translator and lint, not enforced.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        maxLength: { type: "integer", description: "Non-negative character cap; 0 clears it." },
      },
      required: ["key", "maxLength"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => {
    const i = input as { key?: string; maxLength?: number };
    return i.maxLength ? `max length ${i.maxLength} for ${i.key ?? ""}` : `clear max length for ${i.key ?? ""}`;
  },
  run: async (input, ctx: ToolContext) => {
    const { key, maxLength } = input as { key: string; maxLength: number };
    if (maxLength < 0) throw new Error("maxLength must be 0 or greater.");
    const s = ctx.load();
    setMetadata(s, key, { maxLength });
    ctx.persist(s);
    return { ok: true, key, maxLength: s.keys[key]?.maxLength ?? null };
  },
};

const setSourceText: ChatTool = {
  def: {
    name: "set_source_text",
    strict: true,
    description: "Change ONE key's SOURCE-locale text (the original string everything is translated from). Use to fix a typo or reword the source. If the wording actually changes, existing reviewed/machine translations are flagged needs-review automatically, since they may no longer match. Does not apply to plural keys.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string", description: "The new source text." },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `set source text for ${(input as { key?: string }).key ?? ""}`,
  run: async (input, ctx: ToolContext) => {
    const { key, value } = input as { key: string; value: string };
    const s = ctx.load();
    setSourceValue(s, key, value);
    ctx.persist(s);
    return { ok: true, key, source: s.keys[key]?.values[s.config.sourceLocale]?.value ?? "" };
  },
};

const addKey: ChatTool = {
  def: {
    name: "add_key",
    strict: true,
    description: "Create a NEW key with its source-locale text. Use when the user wants to add a string to the catalog. The key is the dotted/slashed path the code references (e.g. \"plant.repot\"); pick one that matches the project's existing naming. Creates a single (non-plural) key. Fails if the key already exists.",
    schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The new key path (e.g. \"plant.repot\")." },
        value: { type: "string", description: "Source-locale text for the new key." },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `add key ${(input as { key?: string }).key ?? ""}`,
  run: async (input, ctx: ToolContext) => {
    const { key, value } = input as { key: string; value: string };
    const s = ctx.load();
    createKey(s, key, value);
    ctx.persist(s);
    return { ok: true, key, source: value.trim() };
  },
};

export const keyWriteTools: ChatTool[] = [setKeyContext, addKeyNote, setTranslation, setTranslationState, addKeyTag, removeKeyTag, setMaxLength, setSourceText, addKey];
