import type { Adapter, ExportResult, ExportedFile, ExportWarning } from "./index.js";
import { resolvePath, localeCollisionWarnings } from "./index.js";
import { resolveFormat, resolveEmptyAs, resolveScalar, resolveForms, resolveLocaleToken, type LocaleCase } from "./options.js";
import { serializeJson } from "../format.js";
import { toI18next, isIcuPluralOrSelect, extractLiterals } from "../placeholders.js";
import { PLURAL_CATEGORIES } from "../schema.js";
import type { State, OutputConfig } from "../schema.js";

// Place `value` at the dotted path within `root`, creating intermediate objects.
// Returns true if it had to clobber a different-shaped existing value (a string
// where a branch is needed, or a branch where a leaf is needed) — i18next's
// nesting cannot represent both, so the caller surfaces it as a warning.
function setNested(root: Record<string, unknown>, path: string[], value: string): boolean {
  let node = root;
  let collided = false;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]!;
    if (typeof node[seg] !== "object" || node[seg] === null) {
      if (node[seg] !== undefined) collided = true;
      node[seg] = {};
    }
    node = node[seg] as Record<string, unknown>;
  }
  const leaf = path[path.length - 1]!;
  if (typeof node[leaf] === "object" && node[leaf] !== null) collided = true;
  node[leaf] = value;
  return collided;
}

const DEFAULT_LOCALE_CASE: LocaleCase = "lower-hyphen";

export const i18nextJson: Adapter = {
  name: "i18next-json",
  capabilities: {
    plural: "native",
    select: "lossy",
    nesting: "nested",
    metadata: false,
    placeholderStyle: "named",
    fileGrouping: "per-locale",
  },
  defaultLocaleCase: DEFAULT_LOCALE_CASE,
  export(state: State, output: OutputConfig): ExportResult {
    const files: ExportedFile[] = [];
    const warnings: ExportWarning[] = [];
    const { indent, finalNewline } = resolveFormat(state, output);
    // sortKeys is forced on: alphabetical is the project-wide deterministic order.
    const fmt = { indent, sortKeys: true, finalNewline };
    const emptyAs = resolveEmptyAs(output, "omit");
    const collided = new Set<string>();
    warnings.push(...localeCollisionWarnings(output, state.config.locales, DEFAULT_LOCALE_CASE));
    for (const locale of state.config.locales) {
      const obj: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(state.keys)) {
        const segments = key.split(".");
        const leaf = segments[segments.length - 1]!;
        const parent = segments.slice(0, -1);
        if (entry.plural) {
          const forms = resolveForms(entry, locale, state.config.sourceLocale, emptyAs);
          if (!forms) continue;
          // i18next v4 plural suffix scheme: one sibling key per stored category.
          for (const cat of PLURAL_CATEGORIES) {
            const body = forms[cat];
            if (body === undefined) continue;
            if (setNested(obj, [...parent, `${leaf}_${cat}`], toI18next(body))) collided.add(key);
          }
          continue;
        }
        const raw = resolveScalar(entry, locale, state.config.sourceLocale, emptyAs);
        if (raw === null) continue;
        if (raw && isIcuPluralOrSelect(raw)) {
          warnings.push({ code: "lossy-plural", key, locale, message: "i18next-json does not yet convert ICU plural/select; written unconverted" });
        }
        // i18next has no escape for its {{name}} interpolation, so a literal whose
        // content is itself a {{name}} token will be substituted at runtime.
        if (raw && extractLiterals(raw).some((lit) => /\{\{\w+\}\}/.test(lit))) {
          warnings.push({ code: "lossy-literal", key, locale, message: "i18next will interpolate a literal containing {{…}}; i18next has no escape for it" });
        }
        if (setNested(obj, segments, toI18next(raw))) collided.add(key);
      }
      files.push({ path: resolvePath(output.path, resolveLocaleToken(output, locale, DEFAULT_LOCALE_CASE)), contents: serializeJson(obj, fmt) });
    }
    for (const key of [...collided].sort()) {
      warnings.push({ code: "key-collision", key, message: "key collides with another key's nesting path; one value was overwritten" });
    }
    return { files, warnings };
  },
};
