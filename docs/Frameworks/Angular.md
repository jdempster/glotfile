# Angular

Glotfile works with Angular's `@angular/localize` XLIFF files through the **`angular-xliff`** adapter (XLIFF 1.2).

## Angular owns the source — glotfile syncs from it

This is the one framework where your **code** is the source of truth, not `glotfile.json`. You mark strings with `i18n` in templates and Angular's `ng extract-i18n` generates `messages.xlf`. Glotfile **syncs from** that file rather than owning the source copy — so the day-to-day command is `glotfile sync`, not `import`.

The loop:

```bash
ng extract-i18n                 # 1. Angular writes src/locale/messages.xlf (source keys + copy)
glotfile sync                   # 2. merge messages.xlf into glotfile.json
glotfile translate              # 3. fill the other locales
glotfile export                 # 4. write src/locale/messages.{locale}.xlf
ng build --localize             # 5. Angular builds one bundle per locale
```

`glotfile sync` merges the re-extracted source into your catalog **preserving** glossary, key context, and reviewed translations, and detects keys you removed from the source. Preview with `--dry-run`; add `--prune` to drop keys that no longer appear in `messages.xlf`. Re-run `sync` (never `import`) every time you re-extract.

## Configure the output

```json
{ "adapter": "angular-xliff", "path": "src/locale/messages.{locale}.xlf" }
```

The untranslated `messages.xlf` stays owned by Angular; glotfile only writes the per-locale `messages.{locale}.xlf` files.

## Format notes

- **Placeholders** — `{name}` ↔ `<x id="INTERPOLATION" equiv-text="{{name}}"/>`.
- **Literals** — mark literal text with ICU apostrophe quoting (`'{site}'`) and it renders as plain text instead of an `<x/>` placeholder. Apostrophe quoting is ICU's native escape, so it round-trips fully. See Placeholders and ICU.
- **Plurals** — native ICU using Angular's `VAR_PLURAL` argument.
- **Locale codes** — default to BCP-47 hyphen (`messages.pt-BR.xlf`), written into the `target-language` attribute. See Output Formats.

## Related

- Output Formats · Placeholders and ICU · Plurals · Scan · Translation Workflow
