# Next.js (next-intl)

Glotfile exports to [next-intl](https://next-intl.dev)'s message files with the **`next-intl-json`** adapter — one JSON file per locale, in ICU MessageFormat.

## Configure the output

In Settings → Output Formats (or `glotfile.json`):

```json
{ "adapter": "next-intl-json", "path": "messages/{locale}.json", "style": "nested" }
```

The `style` option controls layout: **`nested`** expands dot-segments into nested objects (`{ "form": { "labels": { "email": … } } }`) — the shape next-intl expects; **`flat`** keeps the dotted keys as-is. New outputs default to nested.

## Import existing strings

```bash
glotfile import
```

Detection looks for `messages/`, `src/messages/`, `locales/`, or `src/locales/` **together with** a next-intl signal (a `next-intl` dependency in `package.json`, or an `i18n/request.ts`), so a plain Vue project isn't mistaken for next-intl. The source locale is read from `defaultLocale` in `i18n/routing.ts` when present.

## Wire next-intl to the exports

`i18n/request.ts` loads the per-locale file glotfile writes:

```ts
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) ?? routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

In components, the namespace passed to `useTranslations` / `getTranslations` is the key prefix:

```tsx
const t = useTranslations('form');
t('labels.email');            // → form.labels.email
t.rich('terms', { terms: (c) => <a href="/terms">{c}</a> });
```

The code scanner understands this: it tracks each `useTranslations('ns')` / `getTranslations('ns')` binding and resolves `t('rel')` to the full `ns.rel` key, so unused-key pruning and the usage tree stay accurate.

## Format notes

- **Placeholders** — `{name}` is used verbatim (next-intl's ICU interpolation).
- **Plurals** — emitted as native ICU (`{count, plural, one {…} other {…}}`), not pipe-delimited. See Plurals.
- **Select** — ICU select (`{gender, select, …}`) passes through natively.
- **Rich text** — `t.rich` markup such as `<terms>…</terms>` is preserved verbatim; supply the tag renderers in code.
- **Literals** — mark literal braces with ICU apostrophe quoting (`'{site}'`); next-intl honours ICU quoting, so it renders verbatim. See Placeholders and ICU.
- **Locale codes** — default to lower-hyphen (`en-gb.json`, `fr-fr.json`). See Output Formats.

## Related

- Output Formats · Placeholders and ICU · Plurals · Quick Start · Translation Workflow
