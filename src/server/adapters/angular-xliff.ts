import type { Adapter, ExportResult, ExportedFile, ExportWarning } from "./index.js";
import { resolvePath, localeCollisionWarnings } from "./index.js";
import { resolveLocaleToken, resolveEmptyAs, resolveScalar, resolveForms, type LocaleCase } from "./options.js";
import { isIcuPluralOrSelect, withLiterals } from "../placeholders.js";
import { PLURAL_CATEGORIES } from "../schema.js";
import type { State, OutputConfig, PluralCategory, PlaceholderMeta } from "../schema.js";

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attrEscape(s: string): string {
  return xmlEscape(s).replace(/"/g, "&quot;");
}

// A token imported from an Angular <x/> element keeps the XLIFF id as its name
// (INTERPOLATION, PH, START_TAG_STRONG, …) plus ctype/equiv-text in placeholder
// metadata; those uppercase tokens are re-emitted verbatim, so an ARB-style
// {count} placeholder with type metadata isn't mistaken for one. A user-named
// $localize placeholder (lowercase id, e.g. `displayName`) escapes that
// convention, so import tags it origin:"x" — also re-emit those verbatim.
function angularXMeta(
  placeholders: Record<string, PlaceholderMeta> | undefined,
  name: string,
): PlaceholderMeta | undefined {
  const meta = placeholders?.[name];
  return /^[A-Z][A-Z0-9_]*$/.test(name) || meta?.origin === "x" ? meta : undefined;
}

// Render {name} tokens as Angular interpolation placeholders. Ids follow
// Angular's extractor convention (INTERPOLATION, INTERPOLATION_1, …) assigned
// by order of first appearance in the SOURCE text; the caller renders the
// source first so a reordered translation reuses the same ids.
function renderInterpolations(
  text: string,
  ids: Map<string, string>,
  placeholders?: Record<string, PlaceholderMeta>,
): string {
  // {name} tokens become <x/> elements only outside ICU apostrophe-quoted literal
  // spans: a literal '{site}' is the literal text {site}, not an interpolation, so
  // withLiterals hands its content to emitLiteral as plain (xml-escaped) text and
  // never assigns it an INTERPOLATION id.
  const convertGap = (gap: string): string => {
    let out = "";
    let last = 0;
    for (const m of gap.matchAll(/\{(\w+)\}/g)) {
      const name = m[1]!;
      out += xmlEscape(gap.slice(last, m.index));
      const meta = angularXMeta(placeholders, name);
      if (meta) {
        const ctype = meta.type ? ` ctype="${attrEscape(meta.type)}"` : "";
        const equiv = meta.example !== undefined ? ` equiv-text="${attrEscape(meta.example)}"` : "";
        out += `<x id="${attrEscape(name)}"${ctype}${equiv}/>`;
      } else {
        let id = ids.get(name);
        if (id === undefined) {
          id = ids.size === 0 ? "INTERPOLATION" : `INTERPOLATION_${ids.size}`;
          ids.set(name, id);
        }
        out += `<x id="${id}" equiv-text="{{${name}}}"/>`;
      }
      last = m.index + m[0].length;
    }
    return out + xmlEscape(gap.slice(last));
  };
  return withLiterals(text, convertGap, (lit) => xmlEscape(`'${lit}'`));
}

// Assemble a plural entry's forms into Angular's ICU text form
// ({VAR_PLURAL, plural, one {…} other {…}}), exact selectors (=0 …) first.
function renderPluralIcu(
  forms: Partial<Record<PluralCategory, string>>,
  ids: Map<string, string>,
  placeholders?: Record<string, PlaceholderMeta>,
): string {
  const cats = [
    ...Object.keys(forms).filter((c) => c.startsWith("=")),
    ...PLURAL_CATEGORIES.filter((c) => forms[c] !== undefined),
  ] as PluralCategory[];
  const branches = cats.map((cat) => `${cat} {${renderInterpolations(forms[cat] ?? "", ids, placeholders)}}`);
  return `{VAR_PLURAL, plural, ${branches.join(" ")}}`;
}

// A value authored as an ICU expression passes through as text, with each ICU
// argument renamed to Angular's canonical VAR_PLURAL / VAR_SELECT.
function renderEmbeddedIcu(value: string): string {
  const renamed = value.replace(
    /\{\s*\w+\s*,\s*(plural|select|selectordinal)\s*,/g,
    (_, type: string) => `{${type === "plural" ? "VAR_PLURAL" : "VAR_SELECT"}, ${type},`,
  );
  return xmlEscape(renamed);
}

function renderScalar(
  value: string,
  ids: Map<string, string>,
  placeholders?: Record<string, PlaceholderMeta>,
): string {
  return isIcuPluralOrSelect(value) ? renderEmbeddedIcu(value) : renderInterpolations(value, ids, placeholders);
}

const DEFAULT_LOCALE_CASE: LocaleCase = "bcp47-hyphen";

export const angularXliff: Adapter = {
  name: "angular-xliff",
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
    const sourceLocale = state.config.sourceLocale;
    const sourceToken = resolveLocaleToken(output, sourceLocale, DEFAULT_LOCALE_CASE);
    const emptyAs = resolveEmptyAs(output, "source");
    const keys = Object.keys(state.keys).sort();
    for (const locale of state.config.locales) {
      if (output.skipSourceLocale && locale === sourceLocale) continue;
      const token = resolveLocaleToken(output, locale, DEFAULT_LOCALE_CASE);
      const units: string[] = [];
      for (const key of keys) {
        const entry = state.keys[key]!;
        let source: string;
        let target: string;
        const ids = new Map<string, string>();
        if (entry.plural) {
          const targetForms = resolveForms(entry, locale, sourceLocale, emptyAs);
          if (targetForms === null) continue;
          source = renderPluralIcu(entry.values[sourceLocale]?.forms ?? {}, ids, entry.placeholders);
          target = renderPluralIcu(targetForms, ids, entry.placeholders);
        } else {
          const targetValue = resolveScalar(entry, locale, sourceLocale, emptyAs);
          if (targetValue === null) continue;
          source = renderScalar(entry.values[sourceLocale]?.value ?? "", ids, entry.placeholders);
          target = renderScalar(targetValue, ids, entry.placeholders);
        }
        // An emptyAs:"source" fallback is marked state="new" (the XLIFF "not yet
        // translated" state) so a later re-import doesn't mistake the copied
        // source text for a real translation.
        const translated =
          locale === sourceLocale ||
          (entry.plural ? entry.values[locale]?.forms !== undefined : !!entry.values[locale]?.value);
        units.push(`      <trans-unit id="${xmlEscape(key)}" datatype="html">`);
        units.push(`        <source>${source}</source>`);
        units.push(`        <target${translated ? "" : ' state="new"'}>${target}</target>`);
        if (entry.description) {
          units.push(`        <note priority="1" from="description">${xmlEscape(entry.description)}</note>`);
        }
        units.push(`      </trans-unit>`);
      }
      const contents =
        `<?xml version="1.0" encoding="UTF-8" ?>\n` +
        `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n` +
        `  <file source-language="${xmlEscape(sourceToken)}" target-language="${xmlEscape(token)}" datatype="plaintext" original="ng2.template">\n` +
        `    <body>\n` +
        (units.length ? units.join("\n") + "\n" : "") +
        `    </body>\n` +
        `  </file>\n` +
        `</xliff>\n`;
      files.push({ path: resolvePath(output.path, token), contents });
    }
    return { files, warnings };
  },
};
