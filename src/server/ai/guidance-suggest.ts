import type { GlossarySource } from "./glossary-suggest.js";

// One-shot AI suggestions for the two translation-guidance config fields
// (config.projectContext and config.localeInstructions[locale]). Both reuse
// selectGlossarySources for a capped, newest-first sample of source strings and
// the provider's complete() method for a single structured-output call.

const FIELD_RULES = [
  "- Write in English; this text instructs the translation model, it is not shown to end users.",
  "- Do NOT restate generic translation rules (placeholders, ICU plurals, typography) — those are enforced separately.",
];

function sourceLines(sources: GlossarySource[]): string {
  return sources.map((s) => `- [${s.key}] ${s.source}`).join("\n");
}

export function buildProjectContextSystemPrompt(): string {
  return [
    "You write a concise PROJECT CONTEXT note for a software localization team.",
    "The note is added to the system prompt of an AI translator for EVERY language, so it must explain what the product is, who uses it, how its key or domain terms should be understood, and the tone/register translations should adopt.",
    "You are given a sample of the app's source UI strings (and any glossary terms). Infer the product and its domain from them.",
    "Rules:",
    "- Write 2–5 sentences of plain prose — no headings, no lists.",
    "- Describe the product and its audience, and call out any term whose meaning could be misread (state the intended sense).",
    "- State the overall tone/register the translations should use.",
    ...FIELD_RULES,
  ].join("\n");
}

export function buildProjectContextUserPrompt(sources: GlossarySource[], glossaryTerms: string[]): string {
  return [
    glossaryTerms.length ? `Glossary terms: ${glossaryTerms.join(", ")}` : "Glossary terms: (none)",
    "",
    "Sample source strings:",
    sourceLines(sources),
    "",
    'Return JSON {"projectContext": "…"} — a single prose string describing this product for translators.',
  ].join("\n");
}

export const PROJECT_CONTEXT_SCHEMA = {
  type: "object",
  properties: {
    projectContext: { type: "string" },
  },
  required: ["projectContext"],
  additionalProperties: false,
} as const;

export function buildLocaleInstructionSystemPrompt(): string {
  return [
    "You propose PER-LANGUAGE translation rules for one target language in a software localization project.",
    "The rules are appended to the AI translator's system prompt for THAT language only, on top of the shared project context.",
    "You are given the target language code, the project context, and a sample of source UI strings.",
    "Rules:",
    "- Suggest concrete, actionable conventions specific to THIS language: register/formality (e.g. formal vs. informal address), how to phrase UI actions, preferred terminology for recurring concepts, and grammar/agreement conventions that keep labels neutral.",
    "- 2–5 short sentences. Be specific to the language; skip anything true of every language.",
    ...FIELD_RULES,
  ].join("\n");
}

export function buildLocaleInstructionUserPrompt(
  locale: string,
  projectContext: string,
  sources: GlossarySource[],
  glossaryTerms: string[],
): string {
  return [
    `Target language: ${locale}`,
    projectContext.trim() ? `Project context: ${projectContext.trim()}` : "Project context: (none provided)",
    glossaryTerms.length ? `Glossary terms: ${glossaryTerms.join(", ")}` : "Glossary terms: (none)",
    "",
    "Sample source strings:",
    sourceLines(sources),
    "",
    'Return JSON {"instruction": "…"} — a single string of rules for this language.',
  ].join("\n");
}

export const LOCALE_INSTRUCTION_SCHEMA = {
  type: "object",
  properties: {
    instruction: { type: "string" },
  },
  required: ["instruction"],
  additionalProperties: false,
} as const;
