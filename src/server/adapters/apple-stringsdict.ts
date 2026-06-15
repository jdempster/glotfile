import type { Adapter, ExportResult, ExportedFile, ExportWarning } from "./index.js";
import { resolvePath, localeCollisionWarnings } from "./index.js";
import { resolveLocaleToken, type LocaleCase } from "./options.js";
import { PLURAL_CATEGORIES } from "../schema.js";
import { withLiterals, isIcuPluralOrSelect } from "../placeholders.js";
import type { State, OutputConfig } from "../schema.js";

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Render the neutral {arg} count token as printf %d. Literal spans ('{site}')
// emit their content verbatim; printf's % sigil is escaped to %% in all
// non-placeholder text — done before the {arg}->%d split so the introduced %d is
// never double-escaped. Split on the literal token so a regex-special arg is
// handled safely.
function toApple(body: string, arg: string): string {
  const gap = (text: string): string => text.replace(/%/g, "%%").split(`{${arg}}`).join("%d");
  if (isIcuPluralOrSelect(body)) return gap(body);
  return withLiterals(body, gap, (lit) => lit.replace(/%/g, "%%"));
}

const DEFAULT_LOCALE_CASE: LocaleCase = "lower-hyphen";

export const appleStringsdict: Adapter = {
  name: "apple-stringsdict",
  capabilities: {
    plural: "native",
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
    const keys = Object.keys(state.keys).sort();
    for (const locale of state.config.locales) {
      const lines: string[] = [];
      for (const key of keys) {
        const entry = state.keys[key]!;
        // A .stringsdict is Apple's plural mechanism; scalar strings live in
        // .strings, so only plural keys belong here.
        if (!entry.plural) continue;
        const lv = entry.values[locale];
        if (!lv?.forms || lv.forms.other === undefined) continue;
        const arg = entry.plural.arg;
        lines.push(`\t<key>${xmlEscape(key)}</key>`);
        lines.push(`\t<dict>`);
        lines.push(`\t\t<key>NSStringLocalizedFormatKey</key>`);
        lines.push(`\t\t<string>%#@${xmlEscape(arg)}@</string>`);
        lines.push(`\t\t<key>${xmlEscape(arg)}</key>`);
        lines.push(`\t\t<dict>`);
        lines.push(`\t\t\t<key>NSStringFormatSpecTypeKey</key>`);
        lines.push(`\t\t\t<string>NSStringPluralRuleType</string>`);
        lines.push(`\t\t\t<key>NSStringFormatValueTypeKey</key>`);
        lines.push(`\t\t\t<string>d</string>`);
        for (const cat of PLURAL_CATEGORIES) {
          const body = lv.forms[cat];
          if (body === undefined) continue;
          lines.push(`\t\t\t<key>${cat}</key>`);
          lines.push(`\t\t\t<string>${xmlEscape(toApple(body, arg))}</string>`);
        }
        lines.push(`\t\t</dict>`);
        lines.push(`\t</dict>`);
      }
      const contents =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTD/PropertyList-1.0.dtd">\n` +
        `<plist version="1.0">\n` +
        `<dict>\n` +
        (lines.length ? lines.join("\n") + "\n" : "") +
        `</dict>\n` +
        `</plist>\n`;
      files.push({ path: resolvePath(output.path, resolveLocaleToken(output, locale, DEFAULT_LOCALE_CASE)), contents });
    }
    return { files, warnings };
  },
};
