import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Parser, ParseResult, ParsedKey } from "../types.js";

const LOCALE_RE = /^[a-z]{2,3}([_-][A-Za-z]{2,4}){0,2}$/;
const FILE_RE = /^messages(?:\.(.+))?\.xlf$/;

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1]!] = decodeEntities(m[2]!);
  return out;
}

type XMeta = { type?: string; example?: string; origin?: "x" };

// Angular's extractor auto-names placeholders in SCREAMING_SNAKE (INTERPOLATION,
// PH, START_TAG_STRONG). The angular-xliff export recognises those by shape and
// re-emits them verbatim; an id outside that convention (a user-named $localize
// placeholder like `displayName`) must be tagged so export keeps its id.
const ANGULAR_CONVENTION_ID = /^[A-Z][A-Z0-9_]*$/;

// Pull source-code locations out of a trans-unit body. Angular emits one
// <context-group purpose="location"> per place a message is used, each holding a
// sourcefile + linenumber context. These feed the usage cache for Angular, whose
// hashed ids never appear literally in code for the regex scanner to find.
function decodeLocations(body: string): { file: string; line: number }[] {
  const out: { file: string; line: number }[] = [];
  const seen = new Set<string>();
  for (const g of body.matchAll(/<context-group\b[^>]*\bpurpose="location"[^>]*>([\s\S]*?)<\/context-group>/g)) {
    const inner = g[1]!;
    const file = inner.match(/<context\b[^>]*context-type="sourcefile"[^>]*>([\s\S]*?)<\/context>/)?.[1];
    if (file === undefined) continue;
    const lineRaw = inner.match(/<context\b[^>]*context-type="linenumber"[^>]*>([\s\S]*?)<\/context>/)?.[1];
    const decodedFile = decodeEntities(file.trim());
    const line = lineRaw ? parseInt(lineRaw.trim(), 10) || 1 : 1;
    const dedup = `${decodedFile}:${line}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    out.push({ file: decodedFile, line });
  }
  return out;
}

// Convert a <source>/<target> body to glotfile text. Angular's inline <x/>
// placeholders become {token}s: a simple interpolation (equiv-text="{{ name }}")
// uses the readable expression name and needs no metadata (export regenerates
// the INTERPOLATION id); anything else — markup markers, block markers, complex
// expressions — keeps the XLIFF id as the token name with ctype/equiv-text
// recorded so export can re-emit the element verbatim.
function decodeInline(raw: string, addMeta: (name: string, meta: XMeta) => void): string {
  let out = "";
  let last = 0;
  for (const m of raw.matchAll(/<x\b([^>]*?)\/>/g)) {
    out += decodeEntities(raw.slice(last, m.index));
    const attrs = parseAttrs(m[1]!);
    const id = attrs["id"] ?? "X";
    const equiv = attrs["equiv-text"];
    const simple = equiv?.match(/^\{\{\s*(\w+)\s*\}\}$/);
    if (simple) {
      out += `{${simple[1]}}`;
    } else {
      out += `{${id}}`;
      const meta: XMeta = {};
      if (attrs["ctype"]) meta.type = attrs["ctype"];
      if (equiv !== undefined) meta.example = equiv;
      if (!ANGULAR_CONVENTION_ID.test(id)) meta.origin = "x";
      addMeta(id, meta);
    }
    last = m.index + m[0].length;
  }
  return out + decodeEntities(raw.slice(last));
}

export const angularXliff: Parser = {
  name: "angular-xliff",
  parse(localeRoot: string, opts?: { locales?: string[] }): ParseResult {
    const warnings: string[] = [];
    const keys: Record<string, ParsedKey> = {};
    const locales: string[] = [];
    const seen = (loc: string) => { if (!locales.includes(loc)) locales.push(loc); };

    // The extraction output (messages.xlf) is parsed first so its <source> text is
    // the authority for the source locale; translation files only fill gaps.
    const files = readdirSync(localeRoot)
      .filter((f) => FILE_RE.test(f))
      .sort((a, b) => (a === "messages.xlf" ? -1 : 0) - (b === "messages.xlf" ? -1 : 0) || a.localeCompare(b));

    for (const file of files) {
      const fnameLocale = file.match(FILE_RE)![1];
      if (fnameLocale !== undefined && !LOCALE_RE.test(fnameLocale)) continue;
      let xml: string;
      try {
        xml = readFileSync(join(localeRoot, file), "utf8");
      } catch (e) {
        warnings.push(`angular-xliff: failed to read ${file}: ${(e as Error).message}`);
        continue;
      }
      const sourceLocale = xml.match(/source-language="([^"]+)"/)?.[1];
      if (!sourceLocale) {
        warnings.push(`angular-xliff: ${file} has no source-language attribute; skipped`);
        continue;
      }
      // Angular's own translation files often omit target-language; fall back to
      // the messages.<locale>.xlf filename convention.
      const targetLocale = xml.match(/target-language="([^"]+)"/)?.[1] ?? fnameLocale;
      if (opts?.locales && !opts.locales.includes(targetLocale ?? sourceLocale)) continue;

      for (const unit of xml.matchAll(/<trans-unit\b([^>]*)>([\s\S]*?)<\/trans-unit>/g)) {
        const id = parseAttrs(unit[1]!)["id"];
        if (!id) {
          warnings.push(`angular-xliff: ${file} has a trans-unit without an id; skipped`);
          continue;
        }
        const body = unit[2]!;
        const src = body.match(/<source\b[^>]*>([\s\S]*?)<\/source>/);
        let tgt = body.match(/<target\b([^>]*)>([\s\S]*?)<\/target>/);
        // state="new" targets are untranslated placeholders (glotfile's own
        // emptyAs:"source" fallback, or a translation tool's pre-fill) — not
        // translations to keep.
        if (tgt && /\bstate="new"/.test(tgt[1]!)) tgt = null;
        const entry = (keys[id] ??= { values: {} });
        const addMeta = (name: string, meta: XMeta) => {
          (entry.placeholders ??= {})[name] ??= meta;
        };
        if (src && entry.values[sourceLocale] === undefined) {
          entry.values[sourceLocale] = decodeInline(src[1]!, addMeta);
          seen(sourceLocale);
        }
        if (tgt && tgt[2] !== "" && targetLocale !== undefined) {
          entry.values[targetLocale] = decodeInline(tgt[2]!, addMeta);
          seen(targetLocale);
        }
        // Locations live in the source catalog (messages.xlf); harvest them once.
        if (entry.locations === undefined) {
          const locs = decodeLocations(body);
          if (locs.length) entry.locations = locs;
        }
      }
    }
    return { locales, keys, warnings };
  },
};
