import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Parser, ParseResult, ParsedKey } from "../types.js";
import { flattenObject } from "../flatten.js";

const LOCALE_RE = /^[a-z]{2,3}([_-][A-Za-z]{2,4}){0,2}$/;

// next-intl stores ICU MessageFormat in nested per-locale JSON. Values are already
// in glotfile's canonical form ({name} interpolation, ICU apostrophe-quoted
// literals, ICU plural/select, <tag> rich-text), so they pass through verbatim —
// plural keys are recognised downstream when assemble parses the source value.
export const nextIntlJson: Parser = {
  name: "next-intl-json",
  parse(localeRoot: string, opts?: { locales?: string[] }): ParseResult {
    const warnings: string[] = [];
    const keys: Record<string, ParsedKey> = {};
    const locales: string[] = [];
    for (const file of readdirSync(localeRoot).sort()) {
      if (!file.endsWith(".json")) continue;
      const locale = file.slice(0, -".json".length);
      if (!LOCALE_RE.test(locale)) continue;
      if (opts?.locales && !opts.locales.includes(locale)) continue;
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(join(localeRoot, file), "utf8"));
      } catch (e) {
        warnings.push(`next-intl-json: failed to parse ${file}: ${(e as Error).message}`);
        continue;
      }
      if (!locales.includes(locale)) locales.push(locale);
      for (const [key, value] of Object.entries(flattenObject(data, "", warnings))) {
        (keys[key] ??= { values: {} }).values[locale] = value;
      }
    }
    return { locales, keys, warnings };
  },
};
