# Output Formats

Glotfile exports your catalog to the locale formats your apps consume. You configure outputs in `config.outputs` (via Settings or the file); each entry names an **adapter** and a **path template**. `glotfile export` writes them all.

```json
"outputs": [
  { "adapter": "flutter-arb",  "path": "lib/l10n/app_{locale}.arb" },
  { "adapter": "laravel-php",  "path": "lang/{locale}/{namespace}.php" },
  { "adapter": "i18next-json", "path": "public/locales/{locale}/translation.json" }
]
```

## Adapters

| Adapter | Target | Placeholder style | Files written |
|---|---|---|---|
| `flutter-arb` | Flutter `.arb` | ICU | one per locale |
| `laravel-php` | Laravel `lang/**/*.php` arrays | `:named` | one per locale **per namespace** |
| `i18next-json` | i18next / generic JSON | `{{named}}` | one per locale |
| `vue-i18n-json` | Vue I18n JSON | `{named}` | one per locale |
| `gettext-po` | gettext `.po` | printf (`%s`) | one per locale |
| `apple-strings` | Apple `.strings` | printf | one per locale |
| `apple-stringsdict` | Apple `.stringsdict` (plurals) | printf | one per locale |
| `angular-xliff` | Angular XLIFF 1.2 (`@angular/localize`) | `<x id="INTERPOLATION"/>` | one per locale |
| `rails-yaml` | Rails i18n `config/locales/*.yml` | `%{named}` | one per locale |

## Path templates

Two tokens are substituted in `path`:

- **`{locale}`** — the locale code (`en`, `fr`, …). Used by every adapter.
- **`{namespace}`** — the **first dot-segment** of the key. Used by adapters that split files by namespace.

> **Example:** How `{namespace}` works — with `laravel-php` and path `lang/{locale}/{namespace}.php`, the key `auth.signIn.button` is written as `signIn.button` inside `lang/fr/auth.php`. Keys with no dot fall into a `messages` namespace.

## Locale code rendering

By default each adapter renders locale codes in its own convention: `flutter-arb` and `laravel-php` use BCP-47 with underscores (`en_US`, `zh_Hant_TW`); `angular-xliff`, `rails-yaml` and `apple-strings` use BCP-47 with hyphens (`en-US`, `pt-BR`); every other adapter uses glotfile's internal lowercase-hyphen form (`en-us`).

### `localeCase`

The optional `localeCase` field on an output entry overrides the adapter default for **all** locales in that output:

| Value | Example |
|---|---|
| `lower-hyphen` | `en-us`, `zh-hant-tw` |
| `lower-underscore` | `en_us`, `zh_hant_tw` |
| `bcp47-hyphen` | `en-US`, `zh-Hant-TW` |
| `bcp47-underscore` | `en_US`, `zh_Hant_TW` |

`localeCase` applies to the `{locale}` filename token **and** any in-file locale token (ARB `@@locale`, gettext `Language:`, XLIFF `target-language`).

### `localeMap`

The optional `localeMap` field maps individual canonical locale codes to exact export tokens, overriding `localeCase` for those locales:

```json
{ "adapter": "flutter-arb", "path": "lib/l10n/app_{locale}.arb",
  "localeMap": { "zh-hant": "zh_HK" } }
```

Keys are **canonical** (lowercase-hyphen) codes and must be locales present in `config.locales`. Use `localeMap` for semantic remaps that no style can express — for example, Flutter rejects script subtags so `zh-hant` must ship as `zh_HK`; Android requires `zh-rHK`.

> **⚠ Locale collision** — if two locales resolve to the same export token after applying `localeCase` and `localeMap`, `glotfile export` emits a `locale-collision` warning and writes only the first locale's file (in config order), skipping the colliding ones rather than silently overwriting.

### Round-trip safety

`glotfile import` sets `localeCase` and `localeMap` automatically: it inspects the filenames it finds, picks the `localeCase` that reproduces them, and records only the exceptions in `localeMap`. A subsequent `glotfile export` produces byte-identical files.

## The `style` option

Some adapters accept an optional `style` to tune their output. For example, `vue-i18n-json` supports a **flat** layout:

```json
{ "adapter": "vue-i18n-json", "path": "src/locales/{locale}.json", "style": "flat" }
```

(Without `style`, JSON adapters nest keys by their dot segments.)

## Lossless where possible, loud where not

Placeholders and ICU `plural`/`select` structure are **preserved** and converted to each format's native mechanism. Where a conversion would be lossy, `glotfile export` emits a **warning** and writes safe output rather than corrupting the file. See Placeholders and ICU.

## Round-tripping (import)

`glotfile import` reads existing files back into the catalog using these same adapters in reverse — inferring `localeCase`/`localeMap` from the filenames so a later export reproduces them byte-for-byte. See import.

## Related

- export · Placeholders and ICU · Plurals · Configuration Reference
