import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Parser, ParseResult, ParsedKey } from "../types.js";
import { categoriesFor, formsToIcu } from "../../plurals.js";
import type { PluralForm } from "../../schema.js";

const LOCALE_RE = /^[a-z]{2,3}([_-][A-Za-z]{2,4}){0,2}$/;

// Keyword line: msgctxt/msgid/msgid_plural/msgstr/msgstr[N] followed by a quoted
// chunk. msgid_plural must be matched before msgid.
const DIRECTIVE_RE = /^(msgctxt|msgid_plural|msgid|msgstr)(?:\[(\d+)\])?[ \t]+"(.*)"\s*$/;
// Bare quoted line continuing the previous directive's string.
const CONT_RE = /^[ \t]*"(.*)"\s*$/;

// Inverse of the export adapter's poString: only the escapes it emits.
function unescapePo(s: string): string {
  return s.replace(/\\([\\"ntr])/g, (_, c: string) =>
    c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c,
  );
}

// Inverse of the export adapter's printf rendering: %% -> a literal %, and %d ->
// the canonical count token. A single left-to-right scan so an escaped %% next
// to a d ("50%%d"? never emitted) can't be misread as %d. `arg` is the canonical
// token to restore; pass "" for scalar values (no count token).
function printfToCanonical(s: string, arg: string): string {
  let out = "";
  for (let i = 0; i < s.length; ) {
    if (s[i] === "%" && s[i + 1] === "%") {
      out += "%";
      i += 2;
      continue;
    }
    if (arg && s[i] === "%" && s[i + 1] === "d") {
      out += `{${arg}}`;
      i += 2;
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
}

interface Entry {
  msgctxt?: string;
  msgid?: string;
  msgidPlural?: string;
  msgstr?: string;
  // msgstr[N] bodies for plural entries, by index.
  plurals: Map<number, string>;
}

function parseEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  let cur: Entry | null = null;
  // Appends a continuation chunk to whichever string the last directive started.
  let append: ((chunk: string) => void) | null = null;
  const flush = () => {
    if (cur && cur.msgid !== undefined) entries.push(cur);
    cur = null;
    append = null;
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    // Translator/extracted/reference/flag comments (#, #., #:, #,) carry no values.
    if (line.startsWith("#")) continue;
    const m = line.match(DIRECTIVE_RE);
    if (m) {
      const kw = m[1]!;
      const idx = m[2];
      const body = unescapePo(m[3]!);
      // A new msgctxt, or a msgid when one is already set, starts the next entry
      // even when no blank separator line precedes it.
      if (cur && (kw === "msgctxt" || (kw === "msgid" && cur.msgid !== undefined))) flush();
      cur ??= { plurals: new Map() };
      const entry = cur;
      if (kw === "msgctxt") {
        entry.msgctxt = body;
        append = (c) => { entry.msgctxt = (entry.msgctxt ?? "") + c; };
      } else if (kw === "msgid") {
        entry.msgid = body;
        append = (c) => { entry.msgid = (entry.msgid ?? "") + c; };
      } else if (kw === "msgid_plural") {
        entry.msgidPlural = body;
        append = (c) => { entry.msgidPlural = (entry.msgidPlural ?? "") + c; };
      } else if (idx !== undefined) {
        const i = Number(idx);
        entry.plurals.set(i, body);
        append = (c) => { entry.plurals.set(i, (entry.plurals.get(i) ?? "") + c); };
      } else {
        entry.msgstr = body;
        append = (c) => { entry.msgstr = (entry.msgstr ?? "") + c; };
      }
      continue;
    }
    const cont = line.match(CONT_RE);
    if (cont && append) append(unescapePo(cont[1]!));
  }
  flush();
  return entries;
}

// .po files the export adapter can produce: <locale>.po at the root,
// <locale>/LC_MESSAGES/*.po, or <locale>/*.po. Other root-level *.po files are
// still parsed, with the header's Language: field supplying the locale.
function discoverPoFiles(root: string): { path: string; rel: string; locale: string | null }[] {
  const found: { path: string; rel: string; locale: string | null }[] = [];
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".po")) {
      const base = e.name.slice(0, -3);
      found.push({ path: join(root, e.name), rel: e.name, locale: LOCALE_RE.test(base) ? base : null });
    } else if (e.isDirectory() && LOCALE_RE.test(e.name)) {
      for (const sub of [join(e.name, "LC_MESSAGES"), e.name]) {
        let names: string[];
        try {
          names = readdirSync(join(root, sub)).sort();
        } catch {
          continue;
        }
        for (const f of names) {
          if (f.endsWith(".po")) found.push({ path: join(root, sub, f), rel: join(sub, f), locale: e.name });
        }
      }
    }
  }
  return found;
}

export const gettextPo: Parser = {
  name: "gettext-po",
  parse(localeRoot: string, opts?: { locales?: string[] }): ParseResult {
    const warnings: string[] = [];
    const keys: Record<string, ParsedKey> = {};
    const locales: string[] = [];
    for (const file of discoverPoFiles(localeRoot)) {
      let entries: Entry[];
      try {
        entries = parseEntries(readFileSync(file.path, "utf8"));
      } catch (e) {
        warnings.push(`gettext-po: failed to parse ${file.rel}: ${(e as Error).message}`);
        continue;
      }
      // The header is the entry with an empty msgid (and no msgctxt); its msgstr
      // holds the Language: field, used when the path doesn't encode the locale.
      const header = entries.find((e) => e.msgid === "" && e.msgctxt === undefined);
      const headerLang = header?.msgstr?.match(/^Language:[ \t]*([A-Za-z0-9_-]+)/m)?.[1];
      const locale = file.locale ?? headerLang;
      if (!locale) {
        warnings.push(`gettext-po: cannot determine locale for ${file.rel}; skipped`);
        continue;
      }
      if (opts?.locales && !opts.locales.includes(locale)) continue;
      if (!locales.includes(locale)) locales.push(locale);
      // The export adapter writes msgstr[i] in this locale's canonical category
      // order (the same mapping its Plural-Forms expression uses), so index i
      // maps straight back to categoriesFor(locale)[i].
      const cats = categoriesFor(locale);
      for (const entry of entries) {
        if (entry === header) continue;
        // The exporter stores the glotfile key in msgctxt; foreign .po files
        // without msgctxt key on the msgid itself.
        const key = entry.msgctxt ?? entry.msgid;
        if (!key) continue;
        if (entry.msgidPlural !== undefined) {
          const forms: Partial<Record<PluralForm, string>> = {};
          for (const [i, body] of [...entry.plurals].sort((a, b) => a[0] - b[0])) {
            if (body === "") continue;
            const cat = cats[i];
            if (!cat) {
              warnings.push(
                `gettext-po: ${file.rel} "${key}": msgstr[${i}] exceeds the ${cats.length} plural forms of "${locale}"; ignored`,
              );
              continue;
            }
            // The exporter rendered the plural arg token as %d; the original arg
            // name is unrecoverable, so "count" is the import convention. %% is
            // restored to a literal %.
            forms[cat] = printfToCanonical(body, "count");
          }
          // No usable "other" form means the entry is untranslated in this locale
          // (parseIcuPlural requires "other"); leave the locale missing.
          if (!forms.other) continue;
          // Synthesize a single ICU plural string: assemble.ts converts a key
          // whose source value parses as ICU plural into a structured plural.
          (keys[key] ??= { values: {} }).values[locale] = formsToIcu("count", forms);
        } else {
          // Empty msgstr is gettext's untranslated marker; keep the locale missing.
          if (!entry.msgstr) continue;
          // Scalar values carry no count token; only restore %% -> literal %.
          (keys[key] ??= { values: {} }).values[locale] = printfToCanonical(entry.msgstr, "");
        }
      }
    }
    return { locales, keys, warnings };
  },
};
