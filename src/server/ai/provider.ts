import type { PluralCategory } from "../schema.js";
import type { ReplyItem } from "./batch.js";
import type { TokenUsage } from "./pricing.js";
import type { ChatMessage, ToolDef, ChatEvent } from "./chat-types.js";

export interface GlossaryHint {
  term: string;
  doNotTranslate?: boolean;
  forced?: string;
  notes?: string;
}
export interface ImageData {
  mediaType: string;
  base64: string;
}
export interface PluralRequest {
  arg: string;
  // Categories REQUIRED for the target locale (may exceed the source's).
  categories: PluralCategory[];
  // The source locale's forms, for the model to translate from.
  sourceForms: Partial<Record<PluralCategory, string>>;
}
export interface TranslationRequest {
  id: string;
  key: string;
  // For a plural item this is the source "other" form (used for glossary
  // scanning and per-form placeholder validation); the forms live in `plural`.
  source: string;
  sourceLocale: string;
  context?: string;
  targetLocale: string;
  maxLength?: number;
  placeholders: string[];
  // Verbatim apostrophe-quoted literal tokens the model must reproduce exactly
  // (e.g. ["'{{gardener}}'"]). extractPlaceholders skips these, so without this
  // list the model has no positive instruction to keep them.
  literals?: string[];
  // Relevant glossary entries (filled by selectRequests).
  glossary?: GlossaryHint[];
  // The key's screenshot, if any (filled by attachScreenshots).
  image?: ImageData;
  // Present ⇒ this is a plural item; the model must return `forms`.
  plural?: PluralRequest;
  // Project-wide description (config.projectContext), injected into the system
  // prompt for every locale. Identical across all requests in a run.
  projectContext?: string;
  // Extra translation rules for this request's target locale
  // (config.localeInstructions[targetLocale]). Stamped in selectRequests.
  localeInstruction?: string;
}
export interface TranslationResult {
  id: string;
  translation?: string;
  forms?: Partial<Record<PluralCategory, string>>;
  error?: string;
}
export interface PromptBlock {
  type: "text" | "image";
  text?: string;
  mediaType?: string;
  base64?: string;
}

export interface CompletionRequest {
  system: string;
  content: PromptBlock[];
  schema: object;
  maxTokens?: number;
}

export type BatchCompleteCallback = (done: number, total: number, batchResults: TranslationResult[]) => void;
// Fired when the model's reply for a batch could not be parsed (raw reply text
// + the size of the batch that produced it), so callers can log the raw
// response for debugging. The batch is then bisected and retried.
export type MalformedReplyCallback = (raw: string, batchSize: number) => void;

export interface TranslationProvider {
  translate(reqs: TranslationRequest[], onBatchComplete?: BatchCompleteCallback, signal?: AbortSignal, onMalformedReply?: MalformedReplyCallback): Promise<TranslationResult[]>;
  supportsVision(): boolean;
  complete(req: CompletionRequest): Promise<unknown>;
  // Drain the token usage accumulated since the last call (or construction).
  // Optional: providers that don't report usage (ollama, claude-code) omit it.
  takeUsage?(): TokenUsage | undefined;
}

// One entry in a provider batch submission: a single-locale chunk of requests
// rendered as one multi-item prompt, exactly like a sync-path batch.
export interface BatchJobSpec {
  customId: string;
  // Invariant: matches every request's targetLocale — the chunk is single-locale by construction.
  locale: string;
  requests: TranslationRequest[];
}

// Per-entry result of a finished batch. "items" parsed cleanly; "malformed"
// carries the raw reply (recovered later via the sync path's bisect retry);
// "failed" covers errored/expired/canceled entries.
export type BatchJobOutcome =
  | { type: "items"; items: ReplyItem[] }
  | { type: "malformed"; raw: string }
  | { type: "failed"; error: string };

export interface BatchRunStatus {
  status: "in_progress" | "canceling" | "ended";
  counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number };
}

// Optional capability: asynchronous batch translation (Anthropic Message
// Batches API today; OpenAI's batch API could implement the same surface).
export interface BatchTranslationProvider extends TranslationProvider {
  submitTranslationBatch(jobs: BatchJobSpec[]): Promise<string>;
  translationBatchStatus(batchId: string): Promise<BatchRunStatus>;
  translationBatchResults(batchId: string): Promise<Map<string, BatchJobOutcome>>;
  cancelTranslationBatch(batchId: string): Promise<void>;
}

export function supportsBatchTranslate(p: TranslationProvider): p is BatchTranslationProvider {
  return typeof (p as Partial<BatchTranslationProvider>).submitTranslationBatch === "function";
}

// One entry in a provider completion batch: an arbitrary structured-output
// request (context builds today), submitted through the same batch API.
export interface CompletionBatchJob {
  customId: string;
  request: CompletionRequest;
}

// Per-entry result of a finished completion batch. "json" parsed cleanly;
// "malformed" carries the raw reply; "failed" covers errored/expired/canceled.
export type CompletionBatchOutcome =
  | { type: "json"; value: unknown }
  | { type: "malformed"; raw: string }
  | { type: "failed"; error: string };

// Optional capability: asynchronous completion batches. Status and cancel are
// shared with translation batches — both wrap the same provider batch ids.
export interface BatchCompletionProvider extends BatchTranslationProvider {
  submitCompletionBatch(jobs: CompletionBatchJob[]): Promise<string>;
  completionBatchResults(batchId: string): Promise<Map<string, CompletionBatchOutcome>>;
}

export function supportsBatchComplete(p: TranslationProvider): p is BatchCompletionProvider {
  return typeof (p as Partial<BatchCompletionProvider>).submitCompletionBatch === "function";
}

// Optional capability: multi-turn conversational tool-use, powering the
// Translation Assistant chat. chat() runs ONE model turn — it yields the
// assistant's text and any tool_use requests, then ends; the orchestrator
// (ai/chat.ts) executes the tools and calls chat() again with the appended
// history. Anthropic implements this today; other providers may later.
export interface ChatProvider extends TranslationProvider {
  chat(messages: ChatMessage[], tools: ToolDef[], system: string, signal?: AbortSignal): AsyncIterable<ChatEvent>;
}

export function supportsChat(p: TranslationProvider): p is ChatProvider {
  return typeof (p as Partial<ChatProvider>).chat === "function";
}

export function buildSystemPrompt(reqs: TranslationRequest[]): string {
  const hasPluralItems = reqs.some((r) => r.plural !== undefined);
  // Project context is config-global, so every request carries the same value;
  // take the first one that has it.
  const projectContext = reqs.find((r) => r.projectContext)?.projectContext?.trim();
  // Per-locale rules only make sense for a single-locale batch — every real
  // provider send is single-locale (runLocaleParallel groups by targetLocale).
  // A mixed-locale array only happens for the activity-log/estimate summary,
  // where attributing one locale's rules to all items would mislabel them, so
  // omit them there rather than lie.
  const locales = new Set(reqs.map((r) => r.targetLocale));
  const targetLocale = reqs[0]?.targetLocale ?? "";
  const localeInstruction = locales.size === 1 ? reqs[0]?.localeInstruction?.trim() : undefined;
  const lines = [
    "You are a professional software localization engine for a UI string catalog.",
    "Your goal: translate each source UI string into its target locale accurately and idiomatically, as a native speaker would phrase it in a real app interface.",
  ];
  if (projectContext) {
    lines.push(
      "",
      "Project context (applies to every string you translate):",
      projectContext,
    );
  }
  lines.push(
    "",
    "You are given, per item: the key path, the source text, optional human context, the target locale, an optional max length, the list of interpolation placeholders, an optional `literals` list, and any relevant glossary entries. Some items also include a screenshot image showing where the string appears in the UI — use it to disambiguate meaning, tone, and length.",
    "",
    "Hard rules:",
    "- Preserve every interpolation placeholder EXACTLY as written: {name}, {{count}}, %s, %d, :name. Never translate, rename, reorder, or remove them.",
    "- Reproduce every entry of the item's `literals` array EXACTLY, including its surrounding apostrophes (e.g. '{{gardener}}', '{name}'). These are app-managed literal tokens, not prose: translate the words around them, but never translate, rename, unquote, or drop them. The apostrophes are required — a result with bare {{gardener}} instead of '{{gardener}}' is wrong.",
    "- Preserve ICU plural/select structure verbatim (e.g. {count, plural, one {…} other {…}}); translate only the human-readable text inside each branch.",
    "- Glossary: a term marked do-not-translate MUST appear unchanged in the translation. A term with a forced translation for the target locale MUST use that exact translation.",
    "- Respect the max length (characters) when given; prefer a shorter natural phrasing over exceeding it.",
    "- Quotation marks and apostrophes: punctuate exactly as a professional native translator instinctively would for the target language — its typographic conventions (e.g. „German“, «French», “English”, ’ for apostrophes), applied with judgment about what is quoted prose versus a literal that must stay untouched. Never emit a raw ASCII double-quote (\") inside a translated string — it corrupts the JSON reply.",
    "- Match the register and capitalization conventions of the target language and of UI microcopy.",
    "- Return ONLY the translated string for each item — no quotes, notes, or explanations.",
  );
  if (hasPluralItems) {
    lines.push(
      "",
      "Plural items: an item with a `plural` field gives you the source plural FORMS (keyed by CLDR category) and the `categories` REQUIRED for the target language. Return a `forms` object with one idiomatic translation per REQUIRED category — including categories the source language does not have (infer them from meaning). Keep the count token shown in the source forms (e.g. {count}) in every form that states a quantity; the `zero`, `one`, and `two` forms MAY omit it when that is natural in the target language — e.g. \"No files\", \"One file\", or a dual form that encodes the count grammatically (Arabic ملفان). Never introduce a placeholder the source did not have. For these items return `forms` instead of `translation`.",
    );
  }
  if (localeInstruction) {
    lines.push(
      "",
      `Additional instructions for the target language (${targetLocale}) — apply these on top of the rules above:`,
      localeInstruction,
    );
  }
  return lines.join("\n");
}

export function buildBatchPrompt(reqs: TranslationRequest[]): string {
  // Every request in a batch shares one target locale — runLocaleParallel groups
  // by targetLocale before batching — so state it once as a directive instead of
  // repeating it on every item. This tells the model the whole batch is a single
  // language (sharper focus, more consistent terminology) and trims tokens.
  const targetLocale = reqs[0]?.targetLocale ?? "";
  const hasPluralItems = reqs.some((r) => r.plural !== undefined);
  const hasGlossaryItems = reqs.some((r) => r.glossary !== undefined && r.glossary.length > 0);
  const items = reqs.map((r) => {
    const base = {
      id: r.id,
      key: r.key,
      context: r.context ?? null,
      maxLength: r.maxLength ?? null,
      // Wrap in braces so the model sees "{site}" not "site" — makes the visual
      // connection to the source string obvious and reduces rename errors.
      placeholders: r.placeholders.map((p) => `{${p}}`),
      ...(r.literals?.length ? { literals: r.literals } : {}),
      ...(r.glossary?.length ? { glossary: r.glossary } : {}),
      hasScreenshot: r.image !== undefined,
    };
    if (r.plural) {
      // Plural items carry the source forms + the required categories instead
      // of a single `source`; the model must reply with `forms`.
      return { ...base, plural: { arg: r.plural.arg, categories: r.plural.categories, sourceForms: r.plural.sourceForms } };
    }
    return { ...base, source: r.source };
  });
  const returnFormat = hasPluralItems
    ? "For a scalar item (has `source`) return {\"id\",\"translation\"}; for a plural item (has `plural`) return {\"id\",\"forms\"} with one string per required category."
    : "Return {\"id\",\"translation\"} for each item.";
  return `Translate every item below into the target locale: ${targetLocale}. All items share this one target language.\n` +
    (hasGlossaryItems ? "Glossary entries are constraints you MUST apply. " : "") +
    "Items with hasScreenshot:true have a screenshot supplied as a separate image block above; use it for context. " +
    `${returnFormat} ` +
    "Return JSON {\"items\":[…]}.\n" +
    JSON.stringify(items, null, 2);
}

export function buildTranslateGemmaSystemPrompt(
  sourceLocale: string,
  targetLocale: string,
  guidance?: { projectContext?: string; localeInstruction?: string },
): string {
  const projectContext = guidance?.projectContext?.trim();
  const localeInstruction = guidance?.localeInstruction?.trim();
  return (
    `You are a professional ${sourceLocale} to ${targetLocale} translator. ` +
    `Your goal is to accurately convey the meaning and nuances of the original ${sourceLocale} text ` +
    `while adhering to ${targetLocale} grammar, vocabulary, and cultural sensitivities. ` +
    (projectContext ? `Project context: ${projectContext} ` : "") +
    `Produce only the ${targetLocale} translation, without any additional explanations or commentary. ` +
    `Preserve every interpolation placeholder exactly as written (e.g. {site}, {count}, {name}) — do not translate, rename, or remove them. ` +
    `Preserve markdown formatting markers exactly as written (e.g. **bold**, *italic*, __underline__) — copy them into the translation in the same positions. ` +
    (localeInstruction ? `Additional instructions for ${targetLocale}: ${localeInstruction} ` : "") +
    `Please translate the following ${sourceLocale} text into ${targetLocale}:`
  );
}

export function buildTranslateGemmaUserPrompt(source: string): string {
  return `\n\n${source}`;
}

export function parseTranslateGemmaResponse(text: string, id: string): TranslationResult {
  const translation = text.trim();
  if (!translation) return { id, error: "No translation returned" };
  return { id, translation };
}

export const BATCH_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          translation: { type: "string" },
          forms: {
            type: "object",
            properties: {
              zero: { type: "string" },
              one: { type: "string" },
              two: { type: "string" },
              few: { type: "string" },
              many: { type: "string" },
              other: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;
