import type { Adapter, ExportResult, ExportedFile, ExportWarning } from "./index.js";
import { resolvePath, localeCollisionWarnings } from "./index.js";
import { nestKeys } from "./shared.js";
import { resolveFormat, resolveEmptyAs, resolveScalar, resolveForms, resolveLocaleToken, type LocaleCase } from "./options.js";
import { toLaravel, isIcuPluralOrSelect, extractPlaceholders } from "../placeholders.js";
import { PLURAL_CATEGORIES, type State, type OutputConfig } from "../schema.js";

function splitKey(key: string): { namespace: string; inner: string } {
  const dot = key.indexOf(".");
  if (dot === -1) return { namespace: "messages", inner: key };
  return { namespace: key.slice(0, dot), inner: key.slice(dot + 1) };
}

function phpString(s: string): string {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

// Serialise a nested object as a PHP array literal, sorting every level for
// determinism. `level` is the current depth (0 = the `return [...]` root).
function phpArray(node: Record<string, unknown>, indent: number, level: number): string {
  const pad = " ".repeat(indent * (level + 1));
  const closePad = " ".repeat(indent * level);
  const lines = Object.keys(node).sort().map((key) => {
    const v = node[key];
    const rhs = v && typeof v === "object"
      ? phpArray(v as Record<string, unknown>, indent, level + 1)
      : phpString(String(v));
    return `${pad}${phpString(key)} => ${rhs},`;
  });
  return `[\n${lines.join("\n")}\n${closePad}]`;
}

// Laravel's translation loader keys off directory names under lang/ using
// BCP-47 with underscores and uppercase regions (en_US, zh_HK). A lang/zh-hk/
// dir is never on the lookup chain, so the locale silently falls back to source.
const DEFAULT_LOCALE_CASE: LocaleCase = "bcp47-underscore";

export const laravelPhp: Adapter = {
  name: "laravel-php",
  capabilities: {
    plural: "native",
    select: "lossy",
    nesting: "nested",
    metadata: false,
    placeholderStyle: "named",
    fileGrouping: "per-locale-namespace",
  },
  defaultLocaleCase: DEFAULT_LOCALE_CASE,
  export(state: State, output: OutputConfig): ExportResult {
    const warnings: ExportWarning[] = [];
    warnings.push(...localeCollisionWarnings(output, state.config.locales, DEFAULT_LOCALE_CASE));
    const { indent, finalNewline } = resolveFormat(state, output);
    const emptyAs = resolveEmptyAs(output, "omit");
    // locale -> namespace -> flat { innerKey -> value }
    const tree: Record<string, Record<string, Record<string, string>>> = {};
    for (const locale of state.config.locales) tree[locale] = {};
    for (const [key, entry] of Object.entries(state.keys)) {
      const { namespace, inner } = splitKey(key);
      for (const locale of state.config.locales) {
        if (entry.plural) {
          const forms = resolveForms(entry, locale, state.config.sourceLocale, emptyAs);
          if (!forms) continue;
          const parts = PLURAL_CATEGORIES.map((c) => forms[c])
            .filter((v): v is string => v !== undefined)
            .map((body) => toLaravel(body))
            .filter(Boolean);
          const value = parts.join("|");
          if (!value && locale !== state.config.sourceLocale) continue;
          (tree[locale]![namespace] ??= {})[inner] = value;
        } else {
          const raw = resolveScalar(entry, locale, state.config.sourceLocale, emptyAs);
          if (raw === null) continue;
          if (raw && isIcuPluralOrSelect(raw)) {
            warnings.push({
              code: "lossy-plural",
              key,
              locale,
              message: "laravel-php cannot represent ICU plural/select; written unconverted",
            });
          }
          // Laravel has no escape for its :name syntax, so a literal :name that
          // matches a real placeholder in the same string is interpolated too.
          if (raw) {
            const names = new Set(extractPlaceholders(raw));
            for (const m of raw.matchAll(/:([a-zA-Z][a-zA-Z0-9_]*)/g)) {
              if (names.has(m[1]!)) {
                warnings.push({
                  code: "lossy-literal",
                  key,
                  locale,
                  message: `literal ":${m[1]}" collides with the :${m[1]} placeholder; Laravel will interpolate both`,
                });
                break;
              }
            }
          }
          (tree[locale]![namespace] ??= {})[inner] = toLaravel(raw);
        }
      }
    }
    const files: ExportedFile[] = [];
    for (const [locale, namespaces] of Object.entries(tree)) {
      for (const [namespace, flat] of Object.entries(namespaces)) {
        const { tree: nested, collisions } = nestKeys(flat);
        for (const c of collisions) {
          warnings.push({ code: "key-collision", key: `${namespace}.${c}`, locale, message: "key is both a leaf and a parent; dropped from nested output" });
        }
        const body = `<?php\n\nreturn ${phpArray(nested, indent, 0)};`;
        files.push({ path: resolvePath(output.path, resolveLocaleToken(output, locale, DEFAULT_LOCALE_CASE), namespace), contents: finalNewline ? body + "\n" : body });
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, warnings };
  },
};
