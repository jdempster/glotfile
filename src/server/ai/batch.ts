import type { PluralCategory } from "../schema.js";
import type { TranslationRequest, TranslationResult } from "./provider.js";
import { placeholdersMatch, pluralFormPlaceholdersMatch } from "../placeholders.js";

// What a provider's transport returns per item: scalar items carry `translation`,
// plural items carry `forms`.
export interface ReplyItem {
  id: string;
  translation?: string;
  forms?: Partial<Record<PluralCategory, string>>;
}

// Thrown by a provider's callBatch when the model reply cannot be parsed into
// reply items (invalid JSON, or JSON without an `items` array). Carries the raw
// reply text so runBatched can surface it for logging before retrying.
export class MalformedReplyError extends Error {
  constructor(public readonly raw: string) {
    super("Model reply was not valid translation JSON.");
    this.name = "MalformedReplyError";
  }
}

// Best-effort repair of a reply whose string values contain raw unescaped
// double-quotes — models quoting a UI label ("Tap "Retake"") emit them despite
// the prompt forbidding it, and they do so deterministically, so retrying the
// same item never recovers. Walks the text with a minimal JSON scanner: a
// quote inside a string counts as the closing quote only when the next
// non-whitespace character is valid JSON structure at that point (`:` after a
// key; `}`/`]`, or `,` followed by the start of the next member, after a
// value); every other quote is content and gets escaped. Ambiguous inputs the
// greedy scan gets wrong simply fail the final reparse and return undefined.
function repairUnescapedQuotes(text: string): string | undefined {
  const skipWs = (from: number): number => {
    let i = from;
    while (i < text.length && /\s/.test(text[i]!)) i++;
    return i;
  };
  const stack: { type: "obj" | "arr"; expectingKey: boolean }[] = [];
  let out = "";
  let inString = false;
  let isKey = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const top = stack[stack.length - 1];
    if (inString) {
      if (ch === "\\") {
        out += ch + (text[i + 1] ?? "");
        i++;
      } else if (ch !== '"') {
        out += ch;
      } else {
        const next = text[skipWs(i + 1)];
        const startsNextMember = (): boolean => {
          const after = text[skipWs(skipWs(i + 1) + 1)];
          return top?.type === "obj" ? after === '"' : after === "{" || after === "[" || after === '"';
        };
        const closes = isKey
          ? next === ":"
          : next === "}" || next === "]" || next === undefined || (next === "," && startsNextMember());
        if (closes) {
          inString = false;
          out += ch;
        } else {
          out += '\\"';
        }
      }
      continue;
    }
    out += ch;
    if (ch === '"') {
      inString = true;
      isKey = top?.type === "obj" && top.expectingKey;
    } else if (ch === "{") stack.push({ type: "obj", expectingKey: true });
    else if (ch === "[") stack.push({ type: "arr", expectingKey: false });
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === "," && top?.type === "obj") top.expectingKey = true;
    else if (ch === ":" && top) top.expectingKey = false;
  }
  try {
    JSON.parse(out);
    return out;
  } catch {
    return undefined;
  }
}

// Parse a model reply into ReplyItems, throwing MalformedReplyError (with the
// raw text attached) when it isn't the expected {"items":[…]} shape. Replies
// broken only by unescaped quotes inside string values are repaired rather
// than rejected.
export function parseReplyItems(text: string): ReplyItem[] {
  let parsed: { items?: ReplyItem[] };
  try {
    parsed = JSON.parse(text) as { items?: ReplyItem[] };
  } catch {
    const repaired = repairUnescapedQuotes(text);
    if (repaired === undefined) throw new MalformedReplyError(text);
    parsed = JSON.parse(repaired) as { items?: ReplyItem[] };
  }
  if (!Array.isArray(parsed.items)) throw new MalformedReplyError(text);
  return parsed.items;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Scalar validation: preserve placeholders + respect maxLength, else an error.
// Mirrors PRD §10.
export function validateTranslation(
  req: TranslationRequest,
  translation: string | undefined,
): TranslationResult {
  if (translation === undefined) return { id: req.id, error: "No translation returned." };
  if (!placeholdersMatch(req.source, translation)) {
    return { id: req.id, error: "Placeholder mismatch between source and translation." };
  }
  if (req.maxLength !== undefined && translation.length > req.maxLength) {
    return { id: req.id, translation, error: `Exceeds maxLength (${translation.length} > ${req.maxLength}).` };
  }
  return { id: req.id, translation };
}

// Plural validation: every REQUIRED category present, each form keeps the
// source placeholders (so the count token survives) and respects maxLength.
export function validatePlural(
  req: TranslationRequest,
  forms: Partial<Record<PluralCategory, string>> | undefined,
): TranslationResult {
  if (!forms) return { id: req.id, error: "No translation returned." };
  const plural = req.plural;
  if (!plural) return { id: req.id, error: "validatePlural called on a non-plural request." };
  const cats = plural.categories;
  const missing = cats.filter((c) => typeof forms[c] !== "string");
  if (missing.length) return { id: req.id, error: `Missing plural categories: ${missing.join(", ")}.` };
  // req.source is the representative "other" form. Count-bearing categories must
  // carry exactly its placeholders; zero/one/two may drop the count idiomatically
  // but still may not introduce placeholders the source never had.
  const badPh = cats.find((c) => !pluralFormPlaceholdersMatch(c, req.source, forms[c]!));
  if (badPh) return { id: req.id, error: `Placeholder mismatch in plural form "${badPh}".` };
  if (req.maxLength !== undefined) {
    const over = cats.find((c) => forms[c]!.length > req.maxLength!);
    if (over) return { id: req.id, error: `Plural form "${over}" exceeds maxLength (${forms[over]!.length} > ${req.maxLength}).` };
  }
  // Keep only the required categories, in canonical order.
  const out: Partial<Record<PluralCategory, string>> = {};
  for (const c of cats) out[c] = forms[c]!;
  return { id: req.id, forms: out };
}

// Branch validation on item kind (plural vs scalar).
export function validateReply(req: TranslationRequest, item: ReplyItem | undefined): TranslationResult {
  return req.plural ? validatePlural(req, item?.forms) : validateTranslation(req, item?.translation);
}

// Group requests into batches, call the provider's transport per batch, then
// validate every returned item uniformly (scalar or plural). callBatch returns
// whatever items it could extract; missing ids degrade to per-item errors.
//
// A MalformedReplyError from callBatch (a reply parseReplyItems could neither
// parse nor repair) is reported via onMalformedReply and recovered by
// BISECTION, not by re-sending the same batch: the corruption is usually
// caused by one specific string the model mangles deterministically, so an
// identical retry fails the same way while splitting isolates the poison item
// and salvages every other translation. A single item that is still malformed
// after one retry degrades to a per-item error so one bad string never sinks
// the run.
// onBatchComplete fires after each batch with the cumulative done count, total, and that batch's results.
export async function runBatched(
  reqs: TranslationRequest[],
  batchSize: number,
  callBatch: (batch: TranslationRequest[], signal?: AbortSignal) => Promise<ReplyItem[]>,
  onBatchComplete?: (done: number, total: number, batchResults: TranslationResult[]) => void,
  signal?: AbortSignal,
  onMalformedReply?: (raw: string, batchSize: number) => void,
): Promise<TranslationResult[]> {
  const failBatch = (batch: TranslationRequest[]): TranslationResult[] =>
    batch.map((req) => ({ id: req.id, error: "Model returned malformed JSON for this string." }));

  // isRetry marks a single-item batch that already failed once — its second
  // malformed reply gives up instead of retrying forever.
  async function resolveBatch(batch: TranslationRequest[], isRetry = false): Promise<TranslationResult[]> {
    let reply: ReplyItem[];
    try {
      reply = await callBatch(batch, signal);
    } catch (err) {
      if (!(err instanceof MalformedReplyError)) throw err;
      onMalformedReply?.(err.raw, batch.length);
      if (signal?.aborted) return failBatch(batch);
      if (batch.length === 1) return isRetry ? failBatch(batch) : resolveBatch(batch, true);
      const mid = Math.ceil(batch.length / 2);
      return [...await resolveBatch(batch.slice(0, mid)), ...await resolveBatch(batch.slice(mid))];
    }
    const byId = new Map(reply.map((r) => [r.id, r]));
    return batch.map((req) => validateReply(req, byId.get(req.id)));
  }

  const results: TranslationResult[] = [];
  const total = reqs.length;
  for (const batch of chunk(reqs, Math.max(1, batchSize))) {
    if (signal?.aborted) break;
    const batchResults = await resolveBatch(batch);
    results.push(...batchResults);
    onBatchComplete?.(results.length, total, batchResults);
  }
  return results;
}
