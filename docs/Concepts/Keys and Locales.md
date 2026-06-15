# Keys and Locales

## Keys

A **key** is a stable identifier for one piece of copy, written in **dot notation**:

```
auth.signIn.button
auth.signIn.title
settings.profile.heading
```

Keys live in a **flat map** in `glotfile.json` — the dots are just naming convention, not nesting. The first segment usually acts as a **namespace** (a feature, screen, or file group); some export adapters split files by it (Laravel writes `auth.*` keys into `auth.php`).

Each key holds:

- A **value per locale** (or plural forms).
- A review state per locale.
- Optional metadata — context, notes, tags, a max length, a screenshot, and a skip-translation flag.

Create, rename, and delete keys in the Editor.

## Locales

A **locale** is a language you maintain, identified by a code like `en`, `fr`, `de`, or `pt-BR`. Two settings define them (Settings panel or config):

- **`sourceLocale`** — the one language you author in. Its values have the `source` state and are the basis for every translation.
- **`locales`** — the full list of languages you maintain, including the source.

> **⚠ The source locale must be in the list** — `sourceLocale` must appear in `locales`, or the file fails validation.

### Adding and removing

Manage locales in Settings. Adding a locale gives every key an empty slot for it (which shows up as **missing** until filled). Languages are shown with their flag and name in the UI.

## Missing values

A locale value is **missing** when it has no content for a key. Missing values are:

- highlighted in the Editor (filter to **missing**),
- counted in Analytics,
- what `glotfile translate` fills by default (see translate),
- flagged by the `empty-translation` rule in Checks and Validation.

## Related

- Review States · Plurals · Key Context and Metadata · The State File
