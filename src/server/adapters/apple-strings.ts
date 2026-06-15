import type { Adapter, ExportResult, ExportedFile, ExportWarning } from "./index.js";
import { resolvePath, localeCollisionWarnings } from "./index.js";
import { resolveLocaleToken, resolveScalar, resolveEmptyAs, type LocaleCase } from "./options.js";
import { withLiterals, isIcuPluralOrSelect } from "../placeholders.js";
import type { State, OutputConfig } from "../schema.js";

// .lproj dirs use BCP-47 casing (en-AU, zh-Hans, pt-PT), so this is the default.
const DEFAULT_LOCALE_CASE: LocaleCase = "bcp47-hyphen";

function escape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
}

// Render a canonical scalar value for the printf-family .strings format: literal
// spans ('{site}') emit their content with the apostrophe markers stripped, and
// printf's % sigil is escaped to %% everywhere (including inside literal spans).
function toApple(value: string): string {
  const gap = (text: string): string => text.replace(/%/g, "%%");
  if (isIcuPluralOrSelect(value)) return gap(value);
  return withLiterals(value, gap, (lit) => lit.replace(/%/g, "%%"));
}

export const appleStrings: Adapter = {
  name: "apple-strings",
  capabilities: {
    // Plurals belong in .stringsdict (apple-stringsdict), not the scalar table.
    plural: "none",
    select: "none",
    nesting: "flat",
    metadata: false,
    placeholderStyle: "printf",
    fileGrouping: "per-locale",
  },
  defaultLocaleCase: DEFAULT_LOCALE_CASE,
  export(state: State, output: OutputConfig): ExportResult {
    const files: ExportedFile[] = [];
    const warnings: ExportWarning[] = [];
    warnings.push(...localeCollisionWarnings(output, state.config.locales, DEFAULT_LOCALE_CASE));
    const emptyAs = resolveEmptyAs(output, "source");
    const keys = Object.keys(state.keys).sort();
    for (const locale of state.config.locales) {
      const lines: string[] = [];
      for (const key of keys) {
        const entry = state.keys[key]!;
        if (entry.plural) continue;
        const value = resolveScalar(entry, locale, state.config.sourceLocale, emptyAs);
        if (value === null) continue;
        lines.push(`"${escape(key)}" = "${escape(toApple(value))}";`);
      }
      const contents = lines.length ? lines.join("\n") + "\n" : "";
      files.push({
        path: resolvePath(output.path, resolveLocaleToken(output, locale, DEFAULT_LOCALE_CASE)),
        contents,
      });
    }
    return { files, warnings };
  },
};
