import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Parser, ParseResult, ParsedKey } from "../types.js";

const LOCALE_RE = /^[a-z]{2,3}([_-][A-Za-z]{2,4}){0,2}$/;

// Apple .strings tables live in <locale>.lproj/ dirs. We read the default
// "Localizable.strings" table only; other tables (e.g. InfoPlist.strings) are a
// separate concern and surfaced as a warning rather than silently merged.
const TABLE = "Localizable.strings";

function localeFromLproj(dir: string): string | null {
  const m = dir.match(/^(.+)\.lproj$/);
  if (!m) return null;
  return LOCALE_RE.test(m[1]!) ? m[1]! : null;
}

// Inverse of the export adapter's printf escaping: %% -> a literal %. Scalar
// .strings values carry no count token, so this is the only printf reversal.
function printfToCanonical(s: string): string {
  return s.replace(/%%/g, "%");
}

// Translate a quoted-string body's C-style escapes into their literal chars.
function unescape(body: string): string {
  return body.replace(/\\(U[0-9a-fA-F]{4}|u[0-9a-fA-F]{4}|.)/g, (_m, esc: string) => {
    const c = esc[0];
    if (c === "U" || c === "u") return String.fromCharCode(parseInt(esc.slice(1), 16));
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    if (c === "r") return "\r";
    return esc;
  });
}

interface Pair { key: string; value: string }

// Hand-rolled scanner: skips // and /* */ comments outside string literals, then
// reads "key" = "value"; pairs. Bare (unquoted) keys/values are tolerated. Returns
// the pairs it could read and pushes a warning for any malformed tail.
function parseStrings(text: string, file: string, warnings: string[]): Pair[] {
  const pairs: Pair[] = [];
  let i = 0;
  const n = text.length;

  const skipTrivia = (): void => {
    while (i < n) {
      const c = text[i]!;
      if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
      if (c === "/" && text[i + 1] === "/") {
        i += 2;
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && text[i + 1] === "*") {
        i += 2;
        while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      break;
    }
  };

  // A quoted "..." (escapes honored) or a bare run up to whitespace/= /; .
  const readToken = (): string | null => {
    if (i >= n) return null;
    if (text[i] === '"') {
      i++;
      let raw = "";
      while (i < n) {
        const c = text[i]!;
        if (c === "\\") { raw += c + (text[i + 1] ?? ""); i += 2; continue; }
        if (c === '"') { i++; return unescape(raw); }
        raw += c;
        i++;
      }
      return null;
    }
    let raw = "";
    while (i < n && !/[\s=;]/.test(text[i]!)) raw += text[i++]!;
    return raw.length ? raw : null;
  };

  // After a malformed entry, skip past the next ';' so one bad pair doesn't
  // truncate the rest of the file. Returns false at EOF (nothing left to parse).
  const recover = (): boolean => {
    while (i < n && text[i] !== ";") i++;
    if (i >= n) return false;
    i++;
    return true;
  };

  while (true) {
    skipTrivia();
    if (i >= n) break;
    const key = readToken();
    if (key === null) { warnings.push(`apple-strings: malformed entry in ${file} near offset ${i}`); if (!recover()) break; continue; }
    skipTrivia();
    if (text[i] !== "=") { warnings.push(`apple-strings: expected '=' after key "${key}" in ${file}`); if (!recover()) break; continue; }
    i++;
    skipTrivia();
    const value = readToken();
    if (value === null) { warnings.push(`apple-strings: missing value for key "${key}" in ${file}`); if (!recover()) break; continue; }
    skipTrivia();
    if (text[i] === ";") i++;
    pairs.push({ key, value });
  }
  return pairs;
}

export const appleStrings: Parser = {
  name: "apple-strings",
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
      const others = readdirSync(join(localeRoot, dir)).filter((f) => f.endsWith(".strings") && f !== TABLE);
      if (others.length) {
        warnings.push(`apple-strings: ${dir} has other .strings tables (${others.join(", ")}); only ${TABLE} is imported`);
      }
      for (const { key, value } of parseStrings(text, file, warnings)) {
        (keys[key] ??= { values: {} }).values[locale] = printfToCanonical(value);
      }
    }
    return { locales, keys, warnings };
  },
};
