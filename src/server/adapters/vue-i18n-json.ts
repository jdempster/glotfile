import type { Adapter, ExportResult, ExportedFile, ExportWarning } from "./index.js";
import { resolvePath, localeCollisionWarnings } from "./index.js";
import { nestKeys } from "./shared.js";
import { resolveFormat, resolveEmptyAs, resolveScalar, resolveForms, resolveLocaleToken, type LocaleCase } from "./options.js";
import { serializeJson } from "../format.js";
import { isIcuPluralOrSelect, withLiterals } from "../placeholders.js";
import { PLURAL_CATEGORIES, type State, type OutputConfig } from "../schema.js";

const DEFAULT_LOCALE_CASE: LocaleCase = "lower-hyphen";

// Canonical {name} stays {name} — vue-i18n's native interpolation matches the
// canonical syntax. A canonical literal span ('{site}') becomes vue's literal
// interpolation {'{site}'}, which renders verbatim instead of substituting.
// ICU plural/select strings are passed through unconverted (their braces are
// not gaps), matching the existing lossy-plural behaviour.
function toVueI18n(value: string): string {
  if (isIcuPluralOrSelect(value)) return value;
  return withLiterals(value, (gap) => gap, (content) => `{'${content}'}`);
}

export const vueI18nJson: Adapter = {
  name: "vue-i18n-json",
  capabilities: {
    plural: "native",
    select: "lossy",
    nesting: "both",
    metadata: false,
    placeholderStyle: "named",
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
          const parts = PLURAL_CATEGORIES.map((c) => forms[c]).filter((v): v is string => v !== undefined).map(toVueI18n);
          flat[key] = parts.join(" | ");
        } else {
          const raw = resolveScalar(entry, locale, state.config.sourceLocale, emptyAs);
          if (raw === null) continue;
          if (raw && isIcuPluralOrSelect(raw)) {
            warnings.push({
              code: "lossy-plural",
              key,
              locale,
              message: "vue-i18n-json does not yet convert ICU plural/select; written unconverted",
            });
          }
          flat[key] = toVueI18n(raw);
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
