import type { Parser } from "../types.js";
import { vueI18nJson } from "./vue-i18n-json.js";
import { nextIntlJson } from "./next-intl-json.js";
import { laravelPhp } from "./laravel-php.js";
import { flutterArb } from "./flutter-arb.js";
import { appleStrings } from "./apple-strings.js";
import { angularXliff } from "./angular-xliff.js";
import { gettextPo } from "./gettext-po.js";
import { i18nextJson } from "./i18next-json.js";
import { railsYaml } from "./rails-yaml.js";
import { appleStringsdict } from "./apple-stringsdict.js";

const REGISTRY: Record<string, Parser> = {
  [vueI18nJson.name]: vueI18nJson,
  [nextIntlJson.name]: nextIntlJson,
  [laravelPhp.name]: laravelPhp,
  [flutterArb.name]: flutterArb,
  [appleStrings.name]: appleStrings,
  [angularXliff.name]: angularXliff,
  [gettextPo.name]: gettextPo,
  [i18nextJson.name]: i18nextJson,
  [railsYaml.name]: railsYaml,
  [appleStringsdict.name]: appleStringsdict,
};

export function getParser(name: string): Parser {
  const p = REGISTRY[name];
  if (!p) throw new Error(`Unknown format: ${name} (known: ${Object.keys(REGISTRY).join(", ")})`);
  return p;
}
