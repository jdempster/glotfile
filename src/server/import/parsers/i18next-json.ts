import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Parser, ParseResult, ParsedKey } from "../types.js";
import { flattenObject } from "../flatten.js";
import { formsToIcu } from "../../plurals.js";
import { isIcuPluralOrSelect } from "../../placeholders.js";
import type { PluralForm } from "../../schema.js";

const LOCALE_RE = /^[a-z]{2,3}([_-][A-Za-z]{2,4}){0,2}$/;

// i18next v4 plural suffix on the leaf of a flattened key, e.g. "cart.items_one".
const PLURAL_SUFFIX_RE = /^(.+)_(zero|one|two|few|many|other)$/;

// i18next's plural interpolation variable is always "count", so reassembled ICU
// plurals use it as the argument name (the exporter's original arg name is not
// recoverable from the files).
const PLURAL_ARG = "count";

// i18next's default namespace; its keys import without a prefix so the common
// single-namespace layout ("<locale>/translation.json") round-trips with the
// exporter, which writes every key into one file.
const DEFAULT_NAMESPACE = "translation";

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// {{name}} -> glotfile canonical {name}: the inverse of toI18next, with the same
// ICU guard — a value that is itself an ICU plural/select was exported verbatim,
// so its braces must not be rewritten.
function fromI18next(value: string): string {
  if (isIcuPluralOrSelect(value)) return value;
  return value.replace(/\{\{(\w+)\}\}/g, "{$1}");
}

function ingestFile(
  path: string,
  label: string,
  prefix: string,
  locale: string,
  keys: Record<string, ParsedKey>,
  warnings: string[],
): boolean {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    warnings.push(`i18next-json: failed to parse ${label}: ${(e as Error).message}`);
    return false;
  }
  const fileWarnings: string[] = [];
  const flat = flattenObject(data, "", fileWarnings);
  for (const w of fileWarnings) warnings.push(`i18next-json: ${label}: ${w}`);

  // A suffix family is a plural only when its "_other" form exists non-empty —
  // i18next requires "_other" for plurals; a lone "key_one" is a literal key.
  const families = new Set<string>();
  for (const [k, v] of Object.entries(flat)) {
    const m = PLURAL_SUFFIX_RE.exec(k);
    if (m && m[2] === "other" && v !== "") families.add(m[1]!);
  }

  const pluralForms: Record<string, Partial<Record<PluralForm, string>>> = {};
  for (const [k, raw] of Object.entries(flat)) {
    // Empty string means untranslated: leave the locale missing for this key.
    if (raw === "") continue;
    const value = fromI18next(raw);
    const m = PLURAL_SUFFIX_RE.exec(k);
    if (m && families.has(m[1]!)) {
      (pluralForms[m[1]!] ??= {})[m[2] as PluralForm] = value;
      continue;
    }
    if (families.has(k)) {
      warnings.push(
        `i18next-json: ${label}: key "${k}" collides with its own plural suffix family; the plural wins`,
      );
      continue;
    }
    (keys[prefix + k] ??= { values: {} }).values[locale] = value;
  }
  for (const [base, forms] of Object.entries(pluralForms)) {
    (keys[prefix + base] ??= { values: {} }).values[locale] = formsToIcu(PLURAL_ARG, forms);
  }
  return true;
}

export const i18nextJson: Parser = {
  name: "i18next-json",
  parse(localeRoot: string, opts?: { locales?: string[] }): ParseResult {
    const warnings: string[] = [];
    const keys: Record<string, ParsedKey> = {};
    const locales: string[] = [];
    for (const entry of readdirSync(localeRoot).sort()) {
      const full = join(localeRoot, entry);
      if (safeIsDir(full)) {
        // Per-locale namespace dirs: <locale>/<namespace>.json. Non-default
        // namespaces become a key prefix.
        if (!LOCALE_RE.test(entry)) continue;
        if (opts?.locales && !opts.locales.includes(entry)) continue;
        let any = false;
        for (const file of readdirSync(full).sort()) {
          if (!file.endsWith(".json")) continue;
          const ns = file.slice(0, -".json".length);
          const prefix = ns === DEFAULT_NAMESPACE ? "" : `${ns}.`;
          if (ingestFile(join(full, file), `${entry}/${file}`, prefix, entry, keys, warnings)) any = true;
        }
        if (any && !locales.includes(entry)) locales.push(entry);
      } else if (entry.endsWith(".json")) {
        // Flat layout: <locale>.json directly in the locale root.
        const locale = entry.slice(0, -".json".length);
        if (!LOCALE_RE.test(locale)) continue;
        if (opts?.locales && !opts.locales.includes(locale)) continue;
        if (ingestFile(full, entry, "", locale, keys, warnings) && !locales.includes(locale)) {
          locales.push(locale);
        }
      }
    }
    return { locales, keys, warnings };
  },
};
