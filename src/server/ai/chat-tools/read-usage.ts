import { loadUsageCache, literalMatcher } from "../../scan.js";
import type { Reference } from "../../scan.js";
import { extractSnippets } from "../context.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

// A scan Reference carries no file (the file is the cache record's key); the
// snippet extractor reads the file off each ref, so we carry it alongside.
type FileRef = Reference & { file: string };

// Where a key is actually used in the user's codebase, with code snippets around
// each call site — so the assistant can ground context notes, glossary calls and
// translation reasoning in how a string is really used, not just its text. Reads
// the persisted scan cache (.glotfile/usage.json); no scan == indexed:false.

// Cap the flat reference list so a heavily-reused key can't blow up the reply;
// the snippets are capped separately (and more tightly) by extractSnippets.
const REF_LIMIT = 50;

const byFileLine = (a: { file: string; line: number }, b: { file: string; line: number }) =>
  a.file.localeCompare(b.file) || a.line - b.line;

const readKeyUsage: ChatTool = {
  def: {
    name: "read_key_usage",
    description:
      "Find where a translation key is referenced in the user's codebase, with code snippets around each call site. Use this to see HOW and WHERE a string is actually used — which screen/component, what the surrounding code is doing — so you can write better context, glossary terms and translations, and discuss the string concretely. Returns direct references (file + line + a code snippet), plus indirect evidence: dynamic-prefix matches (the key may be assembled at runtime) and key-shaped string literals found outside call sites (lower confidence). Requires a prior codebase scan; returns indexed:false if none has run.",
    schema: {
      type: "object",
      properties: { key: { type: "string", description: "The exact translation key path to look up (e.g. \"plant.feed\")." } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  humanSummary: (input) => `key usage for ${(input as { key?: string }).key ?? ""}`,
  run: async (input, ctx: ToolContext) => {
    const { key } = input as { key: string };
    const cache = loadUsageCache(ctx.projectRoot);
    if (!cache) {
      return { indexed: false, key, count: 0, refs: [], snippets: [], prefixCount: 0, prefixRefs: [], literalCount: 0, literalRefs: [] };
    }

    // Direct refs feed both the flat location list and the snippet extractor.
    // prefixRefs are dynamic call sites whose prefix this key falls under;
    // literalRefs are key-shaped literals outside a call (weaker evidence) — and
    // a literal sitting on a line we already have as a direct ref is dropped.
    const directRefs: FileRef[] = [];
    const prefixRefs: { file: string; line: number; col: number; scanner: string; prefix: string }[] = [];
    const literalRefs: { file: string; line: number; col: number; literal: string }[] = [];
    for (const [file, entry] of Object.entries(cache.files)) {
      const refLines = new Set<number>();
      for (const r of entry.refs) {
        if (r.key === key) {
          directRefs.push({ key, file, line: r.line, col: r.col, scanner: r.scanner });
          refLines.add(r.line);
        }
      }
      for (const p of entry.prefixes) {
        if (p.prefix && key.startsWith(p.prefix)) {
          prefixRefs.push({ file, line: p.line, col: p.col, scanner: p.scanner, prefix: p.prefix });
        }
      }
      for (const l of entry.literals ?? []) {
        if (literalMatcher(l.literal)(key) && !refLines.has(l.line)) {
          literalRefs.push({ file, line: l.line, col: l.col, literal: l.literal });
        }
      }
    }
    directRefs.sort(byFileLine);
    prefixRefs.sort(byFileLine);
    literalRefs.sort(byFileLine);

    const snippets = extractSnippets(directRefs, ctx.projectRoot, new Map());
    const refs = directRefs.slice(0, REF_LIMIT).map(({ file, line, col, scanner }) => ({ file, line, col, scanner }));

    return {
      indexed: true,
      key,
      scannedAt: cache.scannedAt,
      count: directRefs.length,
      refs,
      refsTruncated: directRefs.length > REF_LIMIT,
      snippets,
      prefixCount: prefixRefs.length,
      prefixRefs,
      literalCount: literalRefs.length,
      literalRefs,
    };
  },
};

export const usageReadTools: ChatTool[] = [readKeyUsage];
