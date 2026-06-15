# Vue I18n

Glotfile exports to Vue I18n's JSON message files with the **`vue-i18n-json`** adapter — one JSON file per locale.

## Configure the output

In Settings → Output Formats (or `glotfile.json`):

```json
{ "adapter": "vue-i18n-json", "path": "src/locales/{locale}.json", "style": "nested" }
```

The `style` option controls layout: **`nested`** expands dot-segments into nested objects (`{ "auth": { "signIn": { "button": … } } }`); **`flat`** keeps the dotted keys as-is. New outputs default to nested.

## Import existing strings

```bash
glotfile import
```

Detection looks in `src/locales/`, `src/i18n/locales/`, `locales/`, and `lang/`. It needs at least two locale files, or one named `en` (or `en-*`), to recognise the layout with confidence.

## Wire Vue to the exports

Load the JSON into `createI18n`:

```js
import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import fr from './locales/fr.json'

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, fr } })
```

Use `t('auth.signIn.button')` in templates; pass a count for plurals: `t('cart.items', n)`.

## Format notes

- **Placeholders** — `{name}` is used verbatim (Vue I18n's named-interpolation syntax).
- **Literals** — mark literal text with ICU apostrophe quoting (`'{site}'`); it exports as Vue's literal interpolation `{'{site}'}` so Vue renders it verbatim instead of substituting. Fully escapable. See Placeholders and ICU.
- **Plurals** — pipe-separated forms (`one | other`), Vue I18n's choice format.
- **Locale codes** — default to lower-hyphen (`fr.json`, `pt-br.json`). See Output Formats.

## Related

- Output Formats · Placeholders and ICU · Plurals · Quick Start · Translation Workflow
