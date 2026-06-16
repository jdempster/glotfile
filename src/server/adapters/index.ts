import type { State, OutputConfig } from "../schema.js";
import { resolveLocaleToken, type LocaleCase } from "./options.js";
import { flutterArb } from "./flutter-arb.js";
import { laravelPhp } from "./laravel-php.js";
import { i18nextJson } from "./i18next-json.js";
import { gettextPo } from "./gettext-po.js";
import { appleStringsdict } from "./apple-stringsdict.js";
import { appleStrings } from "./apple-strings.js";
import { vueI18nJson } from "./vue-i18n-json.js";
import { nextIntlJson } from "./next-intl-json.js";
import { angularXliff } from "./angular-xliff.js";
import { railsYaml } from "./rails-yaml.js";

export type WarningCode =
  | "lossy-plural"
  | "lossy-select"
  | "unsupported-metadata"
  | "placeholder-unmappable"
  | "lossy-literal"
  | "key-collision"
  | "locale-collision";

export interface ExportWarning {
  code: WarningCode;
  key: string;
  locale?: string;
  message: string;
}

export interface ExportedFile { path: string; contents: string }
export interface ExportResult { files: ExportedFile[]; warnings: ExportWarning[] }

export interface AdapterCapabilities {
  plural: "native" | "lossy" | "none";
  select: "native" | "lossy" | "none";
  nesting: "nested" | "flat" | "both";
  metadata: boolean;
  placeholderStyle: "icu" | "named" | "positional" | "printf" | "raw";
  fileGrouping: "per-locale" | "per-locale-namespace";
}

export interface Adapter {
  name: string;
  capabilities: AdapterCapabilities;
  defaultLocaleCase: LocaleCase;
  export(state: State, output: OutputConfig): ExportResult;
}

export function resolvePath(template: string, locale: string, namespace = ""): string {
  return template.replaceAll("{locale}", locale).replaceAll("{namespace}", namespace);
}

// Detect two distinct locales that resolve to the same export token (via
// localeMap or a lossy localeCase). First writer wins at the adapter (locales
// iterate in config order); this surfaces the clash instead of a silent
// overwrite. Returns one warning per colliding token.
export function localeCollisionWarnings(output: OutputConfig, locales: string[], adapterDefault: LocaleCase): ExportWarning[] {
  const byToken = new Map<string, string[]>();
  for (const locale of locales) {
    const token = resolveLocaleToken(output, locale, adapterDefault);
    const group = byToken.get(token) ?? [];
    group.push(locale);
    byToken.set(token, group);
  }
  const warnings: ExportWarning[] = [];
  for (const [token, group] of byToken) {
    if (group.length > 1) {
      warnings.push({
        code: "locale-collision",
        key: "",
        message: `locales ${group.join(", ")} all resolve to the export token "${token}"; only the first (in locale order) is written`,
      });
    }
  }
  return warnings;
}

// Built lazily so the adapter `const`s are read after their modules finish
// evaluating. The adapter modules import this file (for resolvePath), creating
// a circular import; reading flutterArb/laravelPhp at call time avoids the
// init-order trap where they'd be undefined when an adapter is the entry module.
let registry: Record<string, Adapter> | undefined;
function getRegistry(): Record<string, Adapter> {
  return (registry ??= {
    [flutterArb.name]: flutterArb,
    [laravelPhp.name]: laravelPhp,
    [i18nextJson.name]: i18nextJson,
    [gettextPo.name]: gettextPo,
    [appleStringsdict.name]: appleStringsdict,
    [appleStrings.name]: appleStrings,
    [vueI18nJson.name]: vueI18nJson,
    [nextIntlJson.name]: nextIntlJson,
    [angularXliff.name]: angularXliff,
    [railsYaml.name]: railsYaml,
  });
}

export function getAdapter(name: string): Adapter {
  const a = getRegistry()[name];
  if (!a) throw new Error(`Unknown adapter: ${name}`);
  return a;
}
export function listAdapters(): string[] {
  return Object.keys(getRegistry());
}
