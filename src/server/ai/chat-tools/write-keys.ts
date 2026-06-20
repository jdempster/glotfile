import { setMetadata, setSourceValue, createKey } from "../../state.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

// Per-key writes: source text, context, tags, and length budget — the per-string
// guidance the assistant authors. Lingo never writes translations itself (that's
// the app's own translate/review controls), and it has no access to the human
// Notes field (that's for the developer's own annotations); these tools only
// shape the SOURCE and the guidance around it. All single, reversible edits, so
// no confirm gate (the conversational propose-then-wait covers approval). Each
// loads, mutates, persists the WHOLE state.

const setKeyContext: ChatTool = {
  def: {
    name: "set_key_context",
    strict: true,
    description: "Set the context for ONE key — what the string means, where it appears, and anything a translator needs to disambiguate it (e.g. button vs. heading, who the subject is). This is the single biggest per-string quality lever. Pass empty text to clear it. Writing context marks it human-authored.",
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

export const keyWriteTools: ChatTool[] = [setKeyContext, addKeyTag, removeKeyTag, setMaxLength, setSourceText, addKey];
