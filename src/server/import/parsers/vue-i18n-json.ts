import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Parser, ParseResult, ParsedKey } from "../types.js";
import { flattenObject } from "../flatten.js";

const LOCALE_RE = /^[a-z]{2,3}([_-][A-Za-z]{2,4}){0,2}$/;

// vue literal interpolation {'...'} -> canonical apostrophe-quoted literal
// '...': the inverse of the adapter's toVueI18n. A plain {name} is vue's native
// interpolation and matches the canonical syntax, so it is left untouched.
// Literal content is assumed free of embedded apostrophes.
function fromVueI18n(value: string): string {
  return value.replace(/\{'([^']*)'\}/g, "'$1'");
}

export const vueI18nJson: Parser = {
  name: "vue-i18n-json",
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
        warnings.push(`vue-i18n-json: failed to parse ${file}: ${(e as Error).message}`);
        continue;
      }
      if (!locales.includes(locale)) locales.push(locale);
      for (const [key, value] of Object.entries(flattenObject(data, "", warnings))) {
        (keys[key] ??= { values: {} }).values[locale] = fromVueI18n(value);
      }
    }
    return { locales, keys, warnings };
  },
};
