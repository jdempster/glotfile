# `glotfile import`

The inverse of `glotfile export`: it reads your **existing** locale files and ingests them *into* a new `glotfile.json`, so you can onboard a project that already has translations without re-keying everything by hand.

```bash
glotfile import --format laravel-php --source lang/
```

Glotfile parses each file with the chosen adapter, flattens the keys, and assembles a catalog. Existing translations land as `reviewed` (not raw machine output) and the source-locale strings as `source` — ready for review in the Editor.

Every export adapter can also be imported: `laravel-php`, `vue-i18n-json`, `flutter-arb`, `apple-strings`, `apple-stringsdict`, `angular-xliff`, `gettext-po`, `i18next-json`, and `rails-yaml`. Run `glotfile import` with no `--format` to auto-detect the layout.

Two auto-detection notes:

- **iOS projects with both tables**: a project holding `Localizable.strings` *and* `Localizable.stringsdict` auto-detects as `apple-strings` (the scalar table). Importing the `.stringsdict` plurals requires an explicit `--format apple-stringsdict` — and produces its own catalog, so merging both into one state file is currently a manual step.
- **i18next flat files**: only the per-locale-directory layout (`public/locales/<lng>/<ns>.json`) auto-detects as i18next; flat `<lng>.json` files are indistinguishable from vue-i18n and need an explicit `--format i18next-json`.

## Options

| Option | Description |
|---|---|
| `--format <name>` | Source layout adapter to read (e.g. `laravel-php`, `flutter-arb`). Omit to auto-detect. |
| `--source <dir>` | Directory to import from. Defaults to the state file's directory. |
| `--source-locale <code>` | Which locale to treat as the source language. |
| `--locales <list>` | Comma-separated locales to import (default: every locale found). |
| `--cldr` | Expand CLDR plural forms into glotfile plurals. |
| `--force` | Overwrite an existing `glotfile.json`. |
| `--file`, `-f <path>` | Write the catalog to a different state-file path. |

```bash
glotfile import --format flutter-arb --source lib/l10n --source-locale en
glotfile import --format angular-xliff --source src/locale
```

## Angular XLIFF

For `angular-xliff` the source flow is inverted: `ng extract-i18n` owns `messages.xlf` (the source catalog; the locale comes from its `source-language` attribute), and translations live in `messages.<locale>.xlf`. Import reads both; the generated output config sets `skipSourceLocale`, so `glotfile export` writes only the translation files and never touches `messages.xlf`. Inline `<x/>` placeholders become `{NAME}` tokens with their `ctype`/`equiv-text` kept as placeholder metadata, and export reproduces the original elements. Untranslated targets export as the source text marked `state="new"`; import ignores `state="new"` targets, so an extract → import → translate → export loop never mistakes fallback text for a real translation.

## Round-trip safety

Import records the `localeCase` and `localeMap` it inferred from the filenames it found, so a subsequent `glotfile export` reproduces byte-identical files. Round-trip tests assert `import(export(x))` fidelity. See Output Formats.

## Related

- export · Output Formats · Installation
