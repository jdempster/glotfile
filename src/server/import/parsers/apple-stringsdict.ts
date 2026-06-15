import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Parser, ParseResult, ParsedKey } from "../types.js";
import { PLURAL_CATEGORIES } from "../../schema.js";
import type { PluralForm } from "../../schema.js";
import { formsToIcu } from "../../plurals.js";

const LOCALE_RE = /^[a-z]{2,3}([_-][A-Za-z]{2,4}){0,2}$/;

// Apple .stringsdict plural tables live in <locale>.lproj/ dirs alongside the
// .strings tables; we read the default "Localizable.stringsdict" table only.
const TABLE = "Localizable.stringsdict";

function localeFromLproj(dir: string): string | null {
  const m = dir.match(/^(.+)\.lproj$/);
  if (!m) return null;
  return LOCALE_RE.test(m[1]!) ? m[1]! : null;
}

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

type PValue = string | PDict;
type PDict = { [key: string]: PValue };

// Hand-rolled recursive-descent parser for the plist XML subset the exporter
// emits (and the small superset real .stringsdict files use): a root <dict> of
// <key>/<value> pairs where values are <dict>s or scalars. Scalars (<string>,
// <integer>, <real>, <date>, <data>, <true/>, <false/>) all surface as strings;
// only <string> matters here. Throws on anything else so the caller can warn
// per-file.
function parsePlistDict(xml: string): PDict {
  let i = 0;
  const n = xml.length;

  // Skip whitespace, the XML declaration, the DOCTYPE, and comments.
  const skipTrivia = (): void => {
    for (;;) {
      while (i < n && /\s/.test(xml[i]!)) i++;
      if (xml.startsWith("<!--", i)) {
        const end = xml.indexOf("-->", i + 4);
        if (end === -1) throw new Error("unterminated comment");
        i = end + 3;
        continue;
      }
      if (xml.startsWith("<?", i) || (xml.startsWith("<!", i) && !xml.startsWith("<!--", i))) {
        const end = xml.indexOf(">", i);
        if (end === -1) throw new Error("unterminated declaration");
        i = end + 1;
        continue;
      }
      break;
    }
  };

  // Read the tag at i (attributes tolerated and discarded); advances past ">".
  const readTag = (): { name: string; closing: boolean; selfClosing: boolean } => {
    if (xml[i] !== "<") throw new Error(`expected a tag at offset ${i}`);
    const end = xml.indexOf(">", i);
    if (end === -1) throw new Error("unterminated tag");
    let body = xml.slice(i + 1, end).trim();
    i = end + 1;
    const closing = body.startsWith("/");
    if (closing) body = body.slice(1).trim();
    const selfClosing = body.endsWith("/");
    if (selfClosing) body = body.slice(0, -1).trim();
    const name = body.split(/\s/)[0]!;
    if (!name) throw new Error(`empty tag at offset ${end}`);
    return { name, closing, selfClosing };
  };

  // Text content of the just-opened element up to its close tag, entity-decoded.
  const readElementText = (name: string): string => {
    const re = new RegExp(`</${name}\\s*>`, "g");
    re.lastIndex = i;
    const m = re.exec(xml);
    if (!m) throw new Error(`unterminated <${name}>`);
    const text = xml.slice(i, m.index);
    i = m.index + m[0].length;
    return decodeEntities(text);
  };

  const readValue = (tag: { name: string; selfClosing: boolean }): PValue => {
    if (tag.name === "dict") return tag.selfClosing ? {} : readDict();
    if (tag.name === "true" || tag.name === "false") {
      if (!tag.selfClosing) readElementText(tag.name);
      return tag.name;
    }
    if (["string", "integer", "real", "date", "data"].includes(tag.name)) {
      return tag.selfClosing ? "" : readElementText(tag.name);
    }
    throw new Error(`unsupported plist element <${tag.name}>`);
  };

  const readDict = (): PDict => {
    const out: PDict = {};
    for (;;) {
      skipTrivia();
      const tag = readTag();
      if (tag.closing) {
        if (tag.name !== "dict") throw new Error(`unexpected </${tag.name}> inside <dict>`);
        return out;
      }
      if (tag.name !== "key") throw new Error(`expected <key> inside <dict>, got <${tag.name}>`);
      const key = readElementText("key");
      skipTrivia();
      const vt = readTag();
      if (vt.closing) throw new Error(`<key>${key}</key> has no value`);
      out[key] = readValue(vt);
    }
  };

  skipTrivia();
  let tag = readTag();
  if (tag.name === "plist" && !tag.closing && !tag.selfClosing) {
    skipTrivia();
    tag = readTag();
  }
  if (tag.name !== "dict" || tag.closing) throw new Error("expected a root <dict>");
  return tag.selfClosing ? {} : readDict();
}

const VAR_RE = /%#@([^@]*)@/g;

// Inverse of the export adapter's printf rendering in a form body: %% -> a
// literal %, and the count token (%<valueType>, "%d" by default) -> {arg}. A
// single left-to-right scan so an escaped %% before a d ("%%d") is read as a
// literal % then d, never as the count token. `token` is the printf count spec
// for this entry; `arg` the canonical token to restore.
function printfToCanonical(body: string, token: string, arg: string): string {
  let out = "";
  for (let i = 0; i < body.length; ) {
    if (body[i] === "%" && body[i + 1] === "%") {
      out += "%";
      i += 2;
      continue;
    }
    if (body.startsWith(token, i)) {
      out += `{${arg}}`;
      i += token.length;
      continue;
    }
    out += body[i];
    i++;
  }
  return out;
}

// Convert one stringsdict entry into a single ICU plural string, or null (with a
// warning) when the shape can't be represented. Inverts the export adapter:
// the variable name becomes the ICU arg, each CLDR category body has the printf
// count token (%<valueType>, "%d" by default) turned back into {arg}, and any
// literal text around the variable in the format key is folded into every branch.
function entryToIcu(key: string, entry: PValue, file: string, warnings: string[]): string | null {
  const warn = (msg: string): null => {
    warnings.push(`apple-stringsdict: ${file}: key "${key}": ${msg}`);
    return null;
  };
  if (typeof entry !== "object") return warn("value is not a dict; skipped");
  const fmt = entry["NSStringLocalizedFormatKey"];
  if (typeof fmt !== "string") return warn("missing NSStringLocalizedFormatKey; skipped");
  const vars = [...fmt.matchAll(VAR_RE)];
  if (vars.length !== 1) {
    return warn(`format key has ${vars.length} %#@…@ variables; only exactly one is supported; skipped`);
  }
  const arg = vars[0]![1]!;
  // The arg becomes an ICU plural argument name, which must be a word token.
  if (!/^\w+$/.test(arg)) return warn(`variable name "${arg}" is not a valid ICU argument; skipped`);
  const prefix = fmt.slice(0, vars[0]!.index);
  const suffix = fmt.slice(vars[0]!.index + vars[0]![0].length);
  const varDict = entry[arg];
  if (typeof varDict !== "object") return warn(`variable "${arg}" has no dict; skipped`);
  const specType = varDict["NSStringFormatSpecTypeKey"];
  if (specType !== undefined && specType !== "NSStringPluralRuleType") {
    return warn(`variable "${arg}" is not a plural rule (${String(specType)}); skipped`);
  }
  const valueType = varDict["NSStringFormatValueTypeKey"];
  // The printf token that carries the count inside form bodies; export writes %d.
  const token = `%${typeof valueType === "string" && valueType ? valueType : "d"}`;
  const forms: Partial<Record<PluralForm, string>> = {};
  for (const cat of PLURAL_CATEGORIES) {
    const body = varDict[cat];
    if (typeof body !== "string") continue;
    forms[cat] = prefix + printfToCanonical(body, token, arg) + suffix;
  }
  if (forms.other === undefined) return warn(`variable "${arg}" has no "other" form; skipped`);
  return formsToIcu(arg, forms);
}

export const appleStringsdict: Parser = {
  name: "apple-stringsdict",
  parse(localeRoot: string, opts?: { locales?: string[] }): ParseResult {
    const warnings: string[] = [];
    const keys: Record<string, ParsedKey> = {};
    const locales: string[] = [];
    for (const dir of readdirSync(localeRoot).sort()) {
      const locale = localeFromLproj(dir);
      if (!locale) continue;
      if (opts?.locales && !opts.locales.includes(locale)) continue;
      const file = join(localeRoot, dir, TABLE);
      let text: string;
      try {
        if (!statSync(file).isFile()) continue;
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      locales.push(locale);
      const others = readdirSync(join(localeRoot, dir)).filter(
        (f) => f.endsWith(".stringsdict") && f !== TABLE,
      );
      if (others.length) {
        warnings.push(
          `apple-stringsdict: ${dir} has other .stringsdict tables (${others.join(", ")}); only ${TABLE} is imported`,
        );
      }
      let root: PDict;
      try {
        root = parsePlistDict(text);
      } catch (e) {
        warnings.push(`apple-stringsdict: failed to parse ${file}: ${(e as Error).message}`);
        continue;
      }
      for (const key of Object.keys(root).sort()) {
        const icu = entryToIcu(key, root[key]!, file, warnings);
        if (icu === null) continue;
        (keys[key] ??= { values: {} }).values[locale] = icu;
      }
    }
    return { locales, keys, warnings };
  },
};
