import { canonLocale, addLocale } from "../../state.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

// Write the project's translation guidance — the interview's payoff. Both tools
// load the full state, mutate only the guidance field, and persist the WHOLE
// state, so no other config.* section is clobbered (the Settings round-trip
// gotcha). The values feed buildSystemPrompt for every future translation. Both
// are confirm-gated: the user approves the batch (the chat's Approve card) first.

const setProjectContext: ChatTool = {
  confirm: true,
  def: {
    name: "set_project_context",    description: "Set the project-wide context injected into the translator's system prompt for EVERY language — what the product is, who uses it, how domain terms should be read, and the overall tone. Pass empty text to clear it. This applies globally; use set_locale_instruction for per-language rules.",
    schema: {
      type: "object",
      properties: { text: { type: "string", description: "The project context prose (plain English; instructs the translator, not shown to end users)." } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  humanSummary: () => "set project context",
  run: async (input, ctx: ToolContext) => {
    const { text } = input as { text: string };
    const s = ctx.load();
    s.config.projectContext = text.trim();
    ctx.persist(s);
    return { ok: true, projectContext: s.config.projectContext };
  },
};

const setLocaleInstruction: ChatTool = {
  confirm: true,
  def: {
    name: "set_locale_instruction",    description: "Set per-language translation rules appended to the translator's system prompt for ONE target language only (e.g. formal vs informal address, preferred terms, grammar conventions). Pass empty text to remove that language's rules. The language must already be a target — call add_language first if it isn't; this tool only stores guidance and does NOT add the language to the project.",
    schema: {
      type: "object",
      properties: {
        locale: { type: "string", description: "Target language code (BCP-47, e.g. \"de\", \"pt-br\")." },
        text: { type: "string", description: "The rules for this language. Empty clears them." },
      },
      required: ["locale", "text"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `set ${canonLocale((input as { locale?: string }).locale ?? "")} guidance`,
  run: async (input, ctx: ToolContext) => {
    const { locale, text } = input as { locale: string; text: string };
    const loc = canonLocale(locale);
    const s = ctx.load();
    const instructions = { ...(s.config.localeInstructions ?? {}) };
    const trimmed = text.trim();
    if (trimmed) instructions[loc] = trimmed;
    else delete instructions[loc];
    s.config.localeInstructions = instructions;
    ctx.persist(s);
    return { ok: true, locale: loc, instruction: trimmed };
  },
};

const addLanguage: ChatTool = {
  confirm: true,
  def: {
    name: "add_language",    description: "Add a NEW target language to the project so its strings can be translated. Use when the user wants to start localizing into a language that isn't a target yet. Adding the language does NOT translate anything — the user runs translation from the app's own controls afterwards. Idempotent: a no-op if the language is already a target. This does not add the source language.",
    schema: {
      type: "object",
      properties: {
        locale: { type: "string", description: "Target language code (BCP-47, e.g. \"de\", \"pt-br\")." },
      },
      required: ["locale"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `add language ${canonLocale((input as { locale?: string }).locale ?? "")}`,
  run: async (input, ctx: ToolContext) => {
    const { locale } = input as { locale: string };
    const loc = canonLocale(locale);
    if (!loc) throw new Error("A language code is required.");
    const s = ctx.load();
    const alreadyTarget = s.config.locales.some((l) => canonLocale(l) === loc);
    addLocale(s, loc);
    ctx.persist(s);
    return { ok: true, locale: loc, added: !alreadyTarget, locales: s.config.locales };
  },
};

export const guidanceWriteTools: ChatTool[] = [setProjectContext, setLocaleInstruction, addLanguage];
