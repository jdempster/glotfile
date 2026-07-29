import type { Adapter, ExportResult, ExportedFile, ExportWarning } from "./index.js";
import { resolvePath, localeCollisionWarnings } from "./index.js";
import { nestKeys } from "./shared.js";
import { resolveFormat, resolveEmptyAs, resolveScalar, resolveForms, resolveLocaleToken, type LocaleCase } from "./options.js";
import { serializeJson } from "../format.js";
import { formsToIcu } from "../plurals.js";
import type { State, OutputConfig } from "../schema.js";

const DEFAULT_LOCALE_CASE: LocaleCase = "lower-hyphen";

const NESTED_PLURAL_HEAD = /^\{\s*\w+\s*,\s*(?:plural|selectordinal)\s*,/;

// Index of the `}` closing the block that opens at `start`, skipping quoted
// literal spans so an apostrophe-escaped brace never shifts the depth count.
// Returns the last index when the block is unbalanced, so callers copy the rest
// verbatim rather than truncating.
function closingBrace(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const next = s[i + 1];
      if (next === "'") { i++; continue; }
      if (next === "{" || next === "}" || next === "#" || next === "|") {
        let j = i + 1;
        while (j < s.length && s[j] !== "'") j++;
        i = j;
        continue;
      }
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return s.length - 1;
}

// Canonical storage normalizes ICU's `#` to the plural's {arg} token
// (parseIcuPlural), so a plural body has to be turned back on the way out. This
// is not cosmetic: ICU formats `#` with the locale's number rules but
// substitutes a bare {count} raw, so the token form prints "1234 items" where
// next-intl is expected to print "1,234 items". Emitting `#` also keeps
// import → export idempotent for catalogues imported from a hand-written
// next-intl project. Two spans are copied through untouched — a quoted literal
// ('{count}'), which ICU renders verbatim, and a nested plural, which rebinds
// `#` to its own argument.
function argToHash(body: string, arg: string): string {
  const token = `{${arg}}`;
  let out = "";
  for (let i = 0; i < body.length; ) {
    const c = body[i];
    if (c === "'") {
      const next = body[i + 1];
      if (next === "'") { out += "''"; i += 2; continue; }
      if (next === "{" || next === "}" || next === "#" || next === "|") {
        let j = i + 1;
        while (j < body.length && body[j] !== "'") j++;
        out += body.slice(i, j + 1);
        i = j + 1;
        continue;
      }
    }
    if (c === "{") {
      if (NESTED_PLURAL_HEAD.test(body.slice(i))) {
        const end = closingBrace(body, i);
        out += body.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      if (body.startsWith(token, i)) { out += "#"; i += token.length; continue; }
    }
    out += c;
    i++;
  }
  return out;
}

// next-intl reads ICU MessageFormat directly, so the canonical storage form needs
// no rewriting: {name} is native interpolation; an ICU apostrophe-quoted literal
// ('{site}') renders verbatim; ICU select strings and <tag> rich-text markup are
// passed through unchanged. The one assembly step is plurals → native ICU.
export const nextIntlJson: Adapter = {
  name: "next-intl-json",
  capabilities: {
    plural: "native",
    select: "native",
    nesting: "both",
    metadata: false,
    placeholderStyle: "icu",
    fileGrouping: "per-locale",
  },
  defaultLocaleCase: DEFAULT_LOCALE_CASE,
  export(state: State, output: OutputConfig): ExportResult {
    const files: ExportedFile[] = [];
    const warnings: ExportWarning[] = [];
    warnings.push(...localeCollisionWarnings(output, state.config.locales, DEFAULT_LOCALE_CASE));
    const { indent, finalNewline } = resolveFormat(state, output);
    // sortKeys is forced on: alphabetical is the project-wide deterministic order.
    const fmt = { indent, sortKeys: true, finalNewline };
    const emptyAs = resolveEmptyAs(output, "omit");
    const flatOutput = output.style === "flat";
    for (const locale of state.config.locales) {
      const flat: Record<string, string> = {};
      for (const [key, entry] of Object.entries(state.keys)) {
        if (entry.plural) {
          const forms = resolveForms(entry, locale, state.config.sourceLocale, emptyAs);
          if (!forms) continue;
          const arg = entry.plural.arg;
          // An undefined form is a category this locale doesn't use; formsToIcu
          // skips it, so it must stay undefined rather than collapse to "".
          const bodies = Object.fromEntries(
            Object.entries(forms).map(([cat, body]) => [cat, body === undefined ? undefined : argToHash(body, arg)]),
          ) as typeof forms;
          flat[key] = formsToIcu(arg, bodies);
        } else {
          const raw = resolveScalar(entry, locale, state.config.sourceLocale, emptyAs);
          if (raw === null) continue;
          flat[key] = raw;
        }
      }
      let payload: unknown = flat;
      if (!flatOutput) {
        const { tree, collisions } = nestKeys(flat);
        for (const key of collisions) {
          warnings.push({
            code: "key-collision",
            key,
            locale,
            message: "key is both a leaf and a parent; dropped from nested output",
          });
        }
        payload = tree;
      }
      files.push({ path: resolvePath(output.path, resolveLocaleToken(output, locale, DEFAULT_LOCALE_CASE)), contents: serializeJson(payload, fmt) });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, warnings };
  },
};
