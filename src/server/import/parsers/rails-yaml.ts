import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Parser, ParseResult, ParsedKey } from "../types.js";
import { PLURAL_CATEGORIES } from "../../schema.js";
import { railsToCanonical } from "../placeholders.js";

const LOCALE_RE = /^[a-z]{2,3}([_-][A-Za-z]{2,4}){0,2}$/i;

const CATEGORY_SET = new Set<string>(PLURAL_CATEGORIES);

type Node = { [key: string]: Node | string };

function makeNode(): Node {
  // Null prototype so hostile keys like "__proto__" stay plain data.
  return Object.create(null) as Node;
}

// Decode the body of a double-quoted scalar (the escape set the export
// adapter emits, plus pass-through for any other escaped char).
function decodeDouble(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = body[++i];
    if (n === undefined) break;
    // YAML hex escapes: \xXX (2), \uXXXX (4), \UXXXXXXXX (8).
    const hexLen = n === "x" ? 2 : n === "u" ? 4 : n === "U" ? 8 : 0;
    if (hexLen) {
      const hex = body.slice(i + 1, i + 1 + hexLen);
      if (hex.length === hexLen && /^[0-9a-fA-F]+$/.test(hex)) {
        out += String.fromCodePoint(parseInt(hex, 16));
        i += hexLen;
        continue;
      }
    }
    out += n === "n" ? "\n" : n === "r" ? "\r" : n === "t" ? "\t" : n;
  }
  return out;
}

// Scan a quoted token starting at `start` (which must be the opening quote).
// Returns the decoded text and the index just past the closing quote, or null
// when the quote never closes on this line.
function scanQuoted(s: string, start: number): { text: string; end: number } | null {
  const q = s[start]!;
  if (q === '"') {
    for (let i = start + 1; i < s.length; i++) {
      if (s[i] === "\\") i++;
      else if (s[i] === '"') return { text: decodeDouble(s.slice(start + 1, i)), end: i + 1 };
    }
    return null;
  }
  // Single-quoted: '' is the only escape.
  let out = "";
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === "'") {
      if (s[i + 1] === "'") {
        out += "'";
        i++;
      } else {
        return { text: out, end: i + 1 };
      }
    } else {
      out += s[i];
    }
  }
  return null;
}

// Strip a trailing comment from a plain scalar ("#" must be preceded by
// whitespace to count as a comment) and trim.
function stripPlainComment(s: string): string {
  const m = /(^|\s)#/.exec(s);
  return (m && m.index >= 0 ? s.slice(0, m.index) : s).trim();
}

// True when the remainder after a value is only whitespace or a comment.
function onlyTrailing(s: string): boolean {
  return /^\s*(#.*)?$/.test(s);
}

interface ParsedFile {
  // One nested map per top-level key (the locale token).
  roots: Record<string, Node>;
}

// Parse one file's text into nested maps, one per top-level key. Anything
// outside the supported subset is warned about and skipped, never thrown.
function parseYamlSubset(text: string, file: string, warnings: string[]): ParsedFile {
  const roots: Record<string, Node> = {};
  const lines = text.split(/\r?\n/);
  // Frames of (indent, node); the sentinel lets top-level lines attach to a
  // fresh root per locale key.
  let stack: { indent: number; node: Node }[] = [];
  // When set, skip lines indented deeper than this (unsupported subtree).
  let skipDeeperThan: number | null = null;
  // Indent of the previous content line when it was a leaf, used to catch
  // children nested under a scalar (malformed for our purposes).
  let lastLeafIndent: number | null = null;

  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]!;
    const lineNo = n + 1;
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    if (raw.trim() === "---") continue;
    const indentMatch = /^[ \t]*/.exec(raw)![0];
    if (indentMatch.includes("\t")) {
      warnings.push(`rails-yaml: ${file}:${lineNo}: tab in indentation; line skipped`);
      continue;
    }
    const indent = indentMatch.length;
    if (skipDeeperThan !== null) {
      if (indent > skipDeeperThan) continue;
      skipDeeperThan = null;
    }
    const content = raw.slice(indent);

    if (content.startsWith("- ") || content === "-") {
      warnings.push(`rails-yaml: ${file}:${lineNo}: sequences are not supported; node skipped`);
      skipDeeperThan = indent;
      continue;
    }

    // ---- key ----
    let key: string;
    let rest: string;
    if (content[0] === '"' || content[0] === "'") {
      const k = scanQuoted(content, 0);
      if (!k || content[k.end] !== ":") {
        warnings.push(`rails-yaml: ${file}:${lineNo}: unparseable quoted key; line skipped`);
        skipDeeperThan = indent;
        continue;
      }
      key = k.text;
      rest = content.slice(k.end + 1);
    } else {
      // A plain key ends at the first ":" followed by whitespace or EOL.
      const m = /^(.*?):(?=\s|$)/.exec(content);
      if (!m) {
        warnings.push(`rails-yaml: ${file}:${lineNo}: not a "key: value" mapping line; line skipped`);
        skipDeeperThan = indent;
        continue;
      }
      key = m[1]!.trim();
      rest = content.slice(m[0].length);
    }

    if (lastLeafIndent !== null && indent > lastLeafIndent) {
      warnings.push(`rails-yaml: ${file}:${lineNo}: unexpected indentation under a scalar; line skipped`);
      skipDeeperThan = indent - 1;
      continue;
    }

    // Pop to this line's parent frame.
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();

    // ---- value ----
    const trimmed = rest.trim();
    let value: string | null;
    if (trimmed === "" || trimmed.startsWith("#")) {
      // No inline value: this key opens a nested map.
      value = null;
    } else if (trimmed[0] === "&" || trimmed[0] === "*") {
      warnings.push(`rails-yaml: ${file}:${lineNo}: YAML anchors/aliases are not supported; node skipped`);
      skipDeeperThan = indent;
      continue;
    } else if (trimmed[0] === "|" || trimmed[0] === ">") {
      warnings.push(`rails-yaml: ${file}:${lineNo}: block scalars are not supported; node skipped`);
      skipDeeperThan = indent;
      continue;
    } else if (trimmed[0] === "[" || trimmed[0] === "{") {
      warnings.push(`rails-yaml: ${file}:${lineNo}: flow collections are not supported; node skipped`);
      skipDeeperThan = indent;
      continue;
    } else if (trimmed[0] === '"' || trimmed[0] === "'") {
      const v = scanQuoted(trimmed, 0);
      if (!v || !onlyTrailing(trimmed.slice(v.end))) {
        warnings.push(`rails-yaml: ${file}:${lineNo}: unterminated or trailing-garbage quoted value; line skipped`);
        continue;
      }
      value = v.text;
    } else {
      // Plain scalar, taken literally (Rails translations are strings even
      // when they look like booleans or numbers).
      value = stripPlainComment(trimmed);
    }

    if (stack.length === 0) {
      // Top level: the key is a locale token rooting its own map.
      if (value !== null) {
        warnings.push(`rails-yaml: ${file}:${lineNo}: top-level key "${key}" has a scalar value; skipped`);
        lastLeafIndent = indent;
        continue;
      }
      const root = (roots[key] ??= makeNode());
      stack = [{ indent, node: root }];
      lastLeafIndent = null;
      continue;
    }

    const parent = stack[stack.length - 1]!.node;
    if (key in parent) {
      warnings.push(`rails-yaml: ${file}:${lineNo}: duplicate key "${key}"; later value wins`);
    }
    if (value === null) {
      const child = makeNode();
      parent[key] = child;
      stack.push({ indent, node: child });
      lastLeafIndent = null;
    } else {
      parent[key] = value;
      lastLeafIndent = indent;
    }
  }
  return { roots };
}

// A node is a Rails plural when its keys are ONLY CLDR categories and all
// values are scalars. Rails interpolates %{count}; the synthesized ICU
// string therefore always uses "count" as the plural argument so assemble.ts
// can structure the key as a plural from the source value alone.
function asPluralForms(node: Node): Record<string, string> | null {
  const entries = Object.entries(node);
  if (entries.length === 0) return null;
  const forms: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!CATEGORY_SET.has(k) || typeof v !== "string") return null;
    if (v !== "") forms[k] = v;
  }
  // ICU requires "other"; without it the synthesized string would not parse,
  // so fall back to plain nesting.
  if (!("other" in forms)) return null;
  return forms;
}

function synthesizeIcu(forms: Record<string, string>, file: string, key: string, warnings: string[]): string {
  const parts: string[] = [];
  for (const cat of PLURAL_CATEGORIES) {
    const body = forms[cat];
    if (body === undefined) continue;
    if (body.includes("#")) {
      warnings.push(
        `rails-yaml: ${file}: plural "${key}" form "${cat}" contains "#", which ICU reads as the count placeholder`,
      );
    }
    parts.push(`${cat} {${railsToCanonical(body)}}`);
  }
  return `{count, plural, ${parts.join(" ")}}`;
}

export const railsYaml: Parser = {
  name: "rails-yaml",
  parse(localeRoot: string, opts?: { locales?: string[] }): ParseResult {
    const warnings: string[] = [];
    const keys: Record<string, ParsedKey> = {};
    const locales: string[] = [];
    const wanted = opts?.locales?.map((l) => l.toLowerCase());

    const addValue = (key: string, locale: string, value: string) => {
      ((keys[key] ??= { values: {} }).values[locale] = value);
    };

    const flatten = (node: Node, prefix: string, locale: string, file: string) => {
      for (const [k, v] of Object.entries(node)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string") {
          // Empty strings are skipped so the locale stays missing for the key.
          if (v !== "") addValue(key, locale, railsToCanonical(v));
          continue;
        }
        const forms = asPluralForms(v);
        if (forms) addValue(key, locale, synthesizeIcu(forms, file, key, warnings));
        else flatten(v, key, locale, file);
      }
    };

    for (const file of readdirSync(localeRoot).sort()) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
      let text: string;
      try {
        text = readFileSync(join(localeRoot, file), "utf8");
      } catch (e) {
        warnings.push(`rails-yaml: failed to read ${file}: ${(e as Error).message}`);
        continue;
      }
      const { roots } = parseYamlSubset(text, file, warnings);
      // Top-level keys are the authority for the locale (devise.en.yml-style
      // filenames make the filename unreliable).
      for (const token of Object.keys(roots).sort()) {
        if (!LOCALE_RE.test(token)) {
          warnings.push(`rails-yaml: ${file}: top-level key "${token}" is not a locale; subtree skipped`);
          continue;
        }
        if (wanted && !wanted.includes(token.toLowerCase())) continue;
        if (!locales.includes(token)) locales.push(token);
        flatten(roots[token]!, "", token, file);
      }
    }
    return { locales, keys, warnings };
  },
};
