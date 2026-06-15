import type { Adapter, ExportResult, ExportedFile, ExportWarning } from "./index.js";
import { resolvePath, localeCollisionWarnings } from "./index.js";
import { resolveFormat, resolveEmptyAs, resolveScalar, resolveForms, resolveLocaleToken, type LocaleCase } from "./options.js";
import { serializeJson } from "../format.js";
import { extractPlaceholders } from "../placeholders.js";
import { formsToIcu } from "../plurals.js";
import type { State, OutputConfig } from "../schema.js";

const DEFAULT_LOCALE_CASE: LocaleCase = "bcp47-underscore";

export const flutterArb: Adapter = {
  name: "flutter-arb",
  capabilities: {
    plural: "native",
    select: "native",
    nesting: "flat",
    metadata: true,
    placeholderStyle: "icu",
    fileGrouping: "per-locale",
  },
  defaultLocaleCase: DEFAULT_LOCALE_CASE,
  export(state: State, output: OutputConfig): ExportResult {
    const files: ExportedFile[] = [];
    const warnings: ExportWarning[] = [];
    warnings.push(...localeCollisionWarnings(output, state.config.locales, DEFAULT_LOCALE_CASE));
    const { indent, finalNewline } = resolveFormat(state, output);
    // sortKeys:false — the adapter controls order so each "@key" stays next to "key".
    const fmt = { indent, sortKeys: false, finalNewline };
    const includeLocale = output.includeLocale ?? true;
    const emptyAs = resolveEmptyAs(output, "omit");
    const sortedKeys = Object.keys(state.keys).sort();
    // Keep each locale's built object so an alias can clone it and rewrite @@locale.
    const built: Record<string, Record<string, unknown>> = {};
    for (const locale of state.config.locales) {
      const isSource = locale === state.config.sourceLocale;
      const obj: Record<string, unknown> = {};
      const token = resolveLocaleToken(output, locale, DEFAULT_LOCALE_CASE);
      if (includeLocale) obj["@@locale"] = token;
      for (const key of sortedKeys) {
        const entry = state.keys[key]!;
        let value: string;
        let placeholderNames: string[];
        if (entry.plural) {
          const forms = resolveForms(entry, locale, state.config.sourceLocale, emptyAs);
          if (!forms) continue;
          value = formsToIcu(entry.plural.arg, forms);
          // The count arg plus every placeholder used in the source form bodies.
          // Extract from the bodies directly: extractPlaceholders ignores tokens
          // nested inside an assembled ICU plural/select block (placeholders.ts),
          // so feeding it formsToIcu(...) would drop everything but the arg and
          // leave Flutter's gen_l10n with undeclared placeholders.
          const srcForms = entry.values[state.config.sourceLocale]?.forms ?? {};
          placeholderNames = [entry.plural.arg, ...Object.values(srcForms).flatMap((b) => extractPlaceholders(b ?? ""))];
        } else {
          const raw = resolveScalar(entry, locale, state.config.sourceLocale, emptyAs);
          if (raw === null) continue;
          value = raw;
          placeholderNames = extractPlaceholders(raw);
        }
        obj[key] = value;
        if (isSource) {
          const placeholders: Record<string, unknown> = {};
          for (const name of placeholderNames) {
            if (!/^\w+$/.test(name)) continue;
            placeholders[name] = {};
          }
          const meta: Record<string, unknown> = {};
          if (entry.context) meta.description = entry.context;
          if (Object.keys(placeholders).length) meta.placeholders = placeholders;
          if (Object.keys(meta).length) obj["@" + key] = meta;
        }
      }
      built[locale] = obj;
      files.push({ path: resolvePath(output.path, token), contents: serializeJson(obj, fmt) });
    }
    // Write copies of a locale's file under each alias code (e.g. zh-Hans → zh,
    // zh_CN, zh_TW). The body is identical to the canonical locale; only the
    // file name and the in-file @@locale marker carry the alias's own code.
    for (const [canonical, aliasCodes] of Object.entries(output.localeAliases ?? {})) {
      const obj = built[canonical];
      if (!obj) continue;
      for (const code of aliasCodes) {
        const aliasToken = resolveLocaleToken(output, code, DEFAULT_LOCALE_CASE);
        // Re-stamp @@locale to this alias's own code. Reassigning the existing
        // key updates its value while keeping its original first position.
        const aliasObj = includeLocale ? { ...obj, "@@locale": aliasToken } : obj;
        files.push({ path: resolvePath(output.path, aliasToken), contents: serializeJson(aliasObj, fmt) });
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, warnings };
  },
};
