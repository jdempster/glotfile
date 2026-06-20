import type { GlossaryEntry } from "../../schema.js";
import { upsertGlossaryEntry, deleteGlossaryEntry, dismissGlossarySuggestion, removeGlossarySuggestion } from "../../state.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

// Author the glossary — terms that must translate consistently or stay verbatim.
// Each tool loads the full state, mutates only the glossary, and persists the
// WHOLE state (the Settings round-trip gotcha). All confirm-gated: the user
// approves the batch (the chat's Approve card) before any edit runs.

const setGlossaryTerm: ChatTool = {
  confirm: true,
  def: {
    name: "set_glossary_term",
    description: "Add or update a glossary term. Use for product names, brand terms, or domain words that must translate consistently — or stay verbatim across every language. Re-using an existing term updates it.",
    schema: {
      type: "object",
      properties: {
        term: { type: "string", description: "The source-language term exactly as it appears in strings (e.g. \"Sprout\", \"feed\")." },
        aliases: {
          type: "array",
          items: { type: "string" },
          description: "Other source-language surface forms of the SAME term — inflections, plurals, casing variants (e.g. for \"feed\": [\"feeding\", \"feeds\", \"fed\"]). Matching is whole-word, so add these to catch the term where it appears as a different word form.",
        },
        doNotTranslate: { type: "boolean", description: "Keep the term verbatim in every language (brand/product names). Omit or false for terms that DO translate but must stay consistent." },
        caseSensitive: { type: "boolean", description: "Match only the exact casing of the term. Set this for a product name that collides with a common word (e.g. \"Sprout\" the app vs \"sprout\" a new shoot) so the capitalized brand is governed while the lowercase word still translates." },
        translations: {
          type: "object",
          description: "Locale → fixed translation for terms that translate but must be consistent (e.g. { \"de\": \"düngen\" }). You fill these so the user never has to type a foreign word. Omit for do-not-translate terms.",
          additionalProperties: { type: "string" },
        },
        notes: { type: "string", description: "Meaning/usage guidance — especially to disambiguate a homonym (e.g. \"feed = give fertilizer, not a social feed\")." },
      },
      required: ["term"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `add glossary term "${(input as { term?: string }).term ?? ""}"`,
  run: async (input, ctx: ToolContext) => {
    const { term, aliases, doNotTranslate, caseSensitive, translations, notes } = input as
      { term: string; aliases?: string[]; doNotTranslate?: boolean; caseSensitive?: boolean; translations?: Record<string, string>; notes?: string };
    const entry: GlossaryEntry = { term: term.trim() };
    const cleanAliases = (aliases ?? []).map((a) => a.trim()).filter((a) => a && a !== entry.term);
    if (cleanAliases.length) entry.aliases = cleanAliases;
    if (doNotTranslate) entry.doNotTranslate = true;
    if (caseSensitive) entry.caseSensitive = true;
    if (translations && Object.keys(translations).length) entry.translations = translations;
    if (notes?.trim()) entry.notes = notes.trim();
    const s = ctx.load();
    upsertGlossaryEntry(s, entry);
    ctx.persist(s);
    return { ok: true, term: entry.term, glossarySize: s.glossary.length };
  },
};

const removeGlossaryTerm: ChatTool = {
  confirm: true,
  def: {
    name: "remove_glossary_term",
    strict: true,
    description: "Remove a term from the glossary by its exact source spelling.",
    schema: {
      type: "object",
      properties: { term: { type: "string" } },
      required: ["term"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `remove glossary term "${(input as { term?: string }).term ?? ""}"`,
  run: async (input, ctx: ToolContext) => {
    const { term } = input as { term: string };
    const s = ctx.load();
    deleteGlossaryEntry(s, term.trim());
    ctx.persist(s);
    return { ok: true, term: term.trim(), glossarySize: s.glossary.length };
  },
};

const acceptGlossarySuggestion: ChatTool = {
  confirm: true,
  def: {
    name: "accept_glossary_suggestion",
    description: "Promote a pending glossary suggestion (see read_guidance) into a real glossary entry. Carries over its do-not-translate flag and rationale unless you override them.",
    schema: {
      type: "object",
      properties: {
        term: { type: "string", description: "The suggested term to accept (must match a pending suggestion)." },
        doNotTranslate: { type: "boolean", description: "Override the suggestion's do-not-translate flag." },
        translations: {
          type: "object",
          description: "Optional fixed per-locale translations to attach.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["term"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `accept suggestion "${(input as { term?: string }).term ?? ""}"`,
  run: async (input, ctx: ToolContext) => {
    const { term, doNotTranslate, translations } = input as
      { term: string; doNotTranslate?: boolean; translations?: Record<string, string> };
    const wanted = term.trim();
    const s = ctx.load();
    const suggestion = s.glossarySuggestions.find((g) => g.term === wanted && g.status === "pending");
    if (!suggestion) throw new Error(`No pending glossary suggestion for "${wanted}".`);
    const entry: GlossaryEntry = { term: suggestion.term };
    const dnt = doNotTranslate ?? suggestion.doNotTranslate;
    if (dnt) entry.doNotTranslate = true;
    if (suggestion.aliases?.length) entry.aliases = suggestion.aliases;
    if (suggestion.note?.trim()) entry.notes = suggestion.note.trim();
    if (translations && Object.keys(translations).length) entry.translations = translations;
    upsertGlossaryEntry(s, entry);
    removeGlossarySuggestion(s, suggestion.term);
    ctx.persist(s);
    return { ok: true, term: entry.term, glossarySize: s.glossary.length };
  },
};

const dismissSuggestion: ChatTool = {
  confirm: true,
  def: {
    name: "dismiss_glossary_suggestion",
    strict: true,
    description: "Dismiss a pending glossary suggestion so it won't resurface. Use when the suggested term doesn't belong in the glossary.",
    schema: {
      type: "object",
      properties: { term: { type: "string" } },
      required: ["term"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `dismiss suggestion "${(input as { term?: string }).term ?? ""}"`,
  run: async (input, ctx: ToolContext) => {
    const { term } = input as { term: string };
    const s = ctx.load();
    dismissGlossarySuggestion(s, term.trim());
    ctx.persist(s);
    return { ok: true, term: term.trim() };
  },
};

export const glossaryWriteTools: ChatTool[] = [setGlossaryTerm, removeGlossaryTerm, acceptGlossarySuggestion, dismissSuggestion];
