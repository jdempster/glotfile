import type { Adapter, ExportResult, ExportedFile, ExportWarning } from "./index.js";
import { resolvePath, localeCollisionWarnings } from "./index.js";
import { nestKeys } from "./shared.js";
import { resolveFormat, resolveEmptyAs, resolveScalar, resolveForms, resolveLocaleToken, type LocaleCase } from "./options.js";
import { toRuby, isIcuPluralOrSelect } from "../placeholders.js";
import { PLURAL_CATEGORIES, type State, type OutputConfig } from "../schema.js";

// Keys YAML 1.1 (Psych) would read as booleans/null when unquoted.
const RESERVED_KEYS = new Set(["true", "false", "yes", "no", "on", "off", "null", "y", "n"]);

// Always double-quote values: sidesteps the YAML scalar-ambiguity minefield
// (yes/no, 1:30, leading %, leading/trailing spaces) in one move.
function yamlString(s: string): string {
  return '"' + s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t") + '"';
}

function yamlKey(k: string): string {
  if (RESERVED_KEYS.has(k.toLowerCase())) return yamlString(k);
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) ? k : yamlString(k);
}

// Serialise a nested object as YAML map lines, sorting every level for
// determinism. `level` 1 = directly under the locale root key.
function yamlMap(node: Record<string, unknown>, indent: number, level: number): string[] {
  const pad = " ".repeat(indent * level);
  const lines: string[] = [];
  for (const key of Object.keys(node).sort()) {
    const v = node[key];
    if (v && typeof v === "object") {
      lines.push(`${pad}${yamlKey(key)}:`);
      lines.push(...yamlMap(v as Record<string, unknown>, indent, level + 1));
    } else {
      lines.push(`${pad}${yamlKey(key)}: ${yamlString(String(v))}`);
    }
  }
  return lines;
}

const DEFAULT_LOCALE_CASE: LocaleCase = "bcp47-hyphen";

export const railsYaml: Adapter = {
  name: "rails-yaml",
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
    const warnings: ExportWarning[] = [];
    warnings.push(...localeCollisionWarnings(output, state.config.locales, DEFAULT_LOCALE_CASE));
    const { indent, finalNewline } = resolveFormat(state, output);
    const emptyAs = resolveEmptyAs(output, "omit");
    const files: ExportedFile[] = [];
    for (const locale of state.config.locales) {
      const flat: Record<string, string> = {};
      for (const [key, entry] of Object.entries(state.keys)) {
        if (entry.plural) {
          const forms = resolveForms(entry, locale, state.config.sourceLocale, emptyAs);
          if (!forms) continue;
          for (const cat of PLURAL_CATEGORIES) {
            const body = forms[cat];
            if (body !== undefined) flat[`${key}.${cat}`] = toRuby(body);
          }
        } else {
          const raw = resolveScalar(entry, locale, state.config.sourceLocale, emptyAs);
          if (raw === null) continue;
          if (raw && isIcuPluralOrSelect(raw)) {
            warnings.push({
              code: "lossy-plural",
              key,
              locale,
              message: "rails-yaml cannot represent ICU plural/select; written unconverted",
            });
          }
          flat[key] = toRuby(raw);
        }
      }
      const { tree: nested, collisions } = nestKeys(flat);
      for (const c of collisions) {
        warnings.push({ code: "key-collision", key: c, locale, message: "key is both a leaf and a parent; dropped from nested output" });
      }
      const token = resolveLocaleToken(output, locale, DEFAULT_LOCALE_CASE);
      const body = [`${yamlKey(token)}:`, ...yamlMap(nested, indent, 1)].join("\n");
      files.push({ path: resolvePath(output.path, token), contents: finalNewline ? body + "\n" : body });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, warnings };
  },
};
