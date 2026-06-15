import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Parser, ParseResult, ParsedKey } from "../types.js";

const LOCALE_RE = /^[a-z]{2,3}([_-][A-Za-z]{2,4}){0,2}$/;

function localeFromArbName(file: string): string | null {
  const m = file.match(/^(.+)\.arb$/);
  if (!m) return null;
  let locale = m[1]!;
  if (locale.startsWith("app_")) locale = locale.slice(4);
  return LOCALE_RE.test(locale) ? locale : null;
}

// Pull typed placeholder defs out of an ARB `@key.placeholders` block, keeping only
// the fields glotfile stores. Returns undefined when there's nothing typed to keep.
function placeholderMeta(
  raw: unknown,
): Record<string, { type?: string; format?: string; example?: string }> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, { type?: string; format?: string; example?: string }> = {};
  for (const [name, def] of Object.entries(raw as Record<string, unknown>)) {
    if (!def || typeof def !== "object") continue;
    const o = def as Record<string, unknown>;
    const d: { type?: string; format?: string; example?: string } = {};
    if (typeof o.type === "string") d.type = o.type;
    if (typeof o.format === "string") d.format = o.format;
    if (typeof o.example === "string") d.example = o.example;
    if (Object.keys(d).length) out[name] = d;
  }
  return Object.keys(out).length ? out : undefined;
}

export const flutterArb: Parser = {
  name: "flutter-arb",
  parse(localeRoot: string, opts?: { locales?: string[] }): ParseResult {
    const warnings: string[] = [];
    const keys: Record<string, ParsedKey> = {};
    const locales: string[] = [];
    for (const file of readdirSync(localeRoot).sort()) {
      if (!file.endsWith(".arb")) continue;
      const locale = localeFromArbName(file);
      if (!locale) continue;
      if (opts?.locales && !opts.locales.includes(locale)) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(readFileSync(join(localeRoot, file), "utf8"));
      } catch (e) {
        warnings.push(`flutter-arb: failed to parse ${file}: ${(e as Error).message}`);
        continue;
      }
      if (!locales.includes(locale)) locales.push(locale);
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("@@")) continue;
        if (key.startsWith("@")) {
          const meta = placeholderMeta((value as { placeholders?: unknown })?.placeholders);
          if (meta) (keys[key.slice(1)] ??= { values: {} }).placeholders = meta;
          continue;
        }
        if (typeof value !== "string") {
          warnings.push(`flutter-arb: skipped non-string ${file}:${key}`);
          continue;
        }
        (keys[key] ??= { values: {} }).values[locale] = value;
      }
    }
    return { locales, keys, warnings };
  },
};
