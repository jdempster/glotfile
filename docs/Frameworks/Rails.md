# Rails

Glotfile exports to Rails i18n YAML files with the **`rails-yaml`** adapter — one `config/locales/{locale}.yml` per locale.

## Configure the output

In Settings → Output Formats (or `glotfile.json`):

```json
{ "adapter": "rails-yaml", "path": "config/locales/{locale}.yml" }
```

Each file is a nested map under a top-level locale key:

```yaml
en:
  auth:
    sign_in: "Sign in"
  cart:
    items:
      one: "%{count} item"
      other: "%{count} items"
```

The top-level key (`en:`) is authoritative for the locale — not the filename.

## Import existing strings

```bash
glotfile import
```

Detection parses `config/locales/*.yml` by their top-level locale keys. Glotfile reads a safe YAML subset (plain maps and scalar strings); anchors, flow collections, and sequences aren't supported.

## Wire Rails to the exports

Rails auto-loads `config/locales/**/*.yml`. Use `I18n.t('auth.sign_in')`, or the relative `t('.sign_in')` form in views; pass `count:` for plurals.

## Format notes

- **Placeholders** — `{name}` is rendered as Rails' `%{name}`.
- **Literals** — mark literal text with ICU apostrophe quoting (`'{site}'`); it exports as plain `{site}` (Rails interpolates `%{name}`, so bare braces are literal) and round-trips. A literal `%` is best-effort. See Placeholders and ICU.
- **Plurals** — a nested CLDR subtree (`one:` / `other:` / …) that Rails pluralises via `count:`.
- **Locale codes** — default to BCP-47 hyphen (`pt-BR.yml`) and are written as the top-level key. See Output Formats.

## Related

- Output Formats · Placeholders and ICU · Plurals · Quick Start · Translation Workflow
