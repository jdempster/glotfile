import type { Adapter, ExportResult, ExportedFile, ExportWarning } from "./index.js";
import { resolvePath, localeCollisionWarnings } from "./index.js";
import { nestKeys } from "./shared.js";
import { resolveFormat, resolveEmptyAs, resolveScalar, resolveForms, resolveLocaleToken, type LocaleCase } from "./options.js";
import { serializeJson } from "../format.js";
import { formsToIcu } from "../plurals.js";
import type { State, OutputConfig } from "../schema.js";

const DEFAULT_LOCALE_CASE: LocaleCase = "lower-hyphen";

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
          flat[key] = formsToIcu(entry.plural.arg, forms);
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
