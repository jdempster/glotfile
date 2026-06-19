# Feature example glotfiles

Small, self-contained `glotfile.json` catalogs that each exercise a different
set of glotfile features. All use the same fictional persona — **Sprout, a
houseplant-care app** — so the strings read as one product. Every file is a
valid, loadable catalog (it round-trips through `loadState`/`saveState`).

| File | Features it demonstrates |
|---|---|
| [`glossary-and-ai-guidance.glotfile.json`](glossary-and-ai-guidance.glotfile.json) | `projectContext`, per-locale `localeInstructions` (fr vouvoiement, de formal Sie), a `glossary` with do-not-translate brand terms, a forced translation, and a whole-word term; per-key `context`/`contextSource`, timestamped `notes`, `tags`, and all four translation states (`source`, `reviewed`, `machine`, `needs-review`). |
| [`plurals-and-placeholders.glotfile.json`](plurals-and-placeholders.glotfile.json) | Structured plural keys (`plural.arg` + per-locale `forms`) with an `=0` exact selector and full CLDR categories for Polish and Arabic; typed `placeholders`; an ICU `select` message; and an app-managed `'{{link}}'` literal token. |
| [`multi-platform-output.glotfile.json`](multi-platform-output.glotfile.json) | One catalog fanned out to six adapters (Flutter ARB, i18next, Apple `.strings`, Laravel PHP, Rails YAML, Angular XLIFF) with per-output options: `style`, `emptyAs`, `localeCase`, `localeMap`, `localeAliases`, `includeLocale`, `skipSourceLocale`, plus a regional locale (`zh-hant`). |
| [`lint-and-scan.glotfile.json`](lint-and-scan.glotfile.json) | `config.lint` (rule severities, `ignore` globs, per-locale spelling dictionaries), `config.scan` (`include`/`exclude`/`keep`/`patterns`/`accessors`), `spelling.customWords`, and key metadata (`maxLength`, `description`, `skipTranslate`, `tags`). |

## Try one

```bash
# Export a catalog to its configured locale files
cd "$(mktemp -d)" && cp /path/to/plurals-and-placeholders.glotfile.json glotfile.json
node /path/to/glotfile/bin/glotfile.js export

# Or open it in the editor UI
node /path/to/glotfile/bin/glotfile.js serve --file plurals-and-placeholders.glotfile.json
```
