# The State File — `glotfile.json`

Everything Glotfile does is derived from one file at the root of your project: **`glotfile.json`**. It holds your configuration, your glossary, and every key with its translations. You commit it alongside your code, and versioning, review, and rollback all come from git.

> **Tip:** You normally never edit this file by hand — the web UI writes it for you. The structure below is documented so you can read diffs and understand what's stored — not so you can hand-edit it.

## Anatomy

A fresh file looks like this:

```json
{
  "$schema": "https://glotfile.dev/schema/v1.json",
  "version": 1,
  "config": {
    "sourceLocale": "en",
    "locales": ["en"],
    "outputs": [
      { "adapter": "flutter-arb", "path": "lib/l10n/app_{locale}.arb" },
      { "adapter": "laravel-php", "path": "lang/{locale}/{namespace}.php" }
    ],
    "format": { "indent": 2, "sortKeys": true, "finalNewline": true },
    "spelling": { "customWords": [] }
  },
  "glossary": [],
  "keys": {}
}
```

| Field | Purpose |
|---|---|
| `version` | State-file schema version (currently `1`). |
| `config` | All committed configuration — see Configuration Reference. AI provider settings are **not** here; they live in per-machine local settings (see AI Providers). |
| `glossary` | Do-not-translate terms and forced per-locale translations — see Glossary. |
| `keys` | A flat map of dot-notation keys to their values and metadata — see Keys and Locales. |

## A populated key

```json
"keys": {
  "auth.signIn.button": {
    "context": "Primary call-to-action on the login screen",
    "tags": ["auth", "cta"],
    "maxLength": 20,
    "values": {
      "en": { "value": "Sign in", "state": "source" },
      "fr": { "value": "Se connecter", "state": "reviewed", "source": "Sign in" },
      "de": { "value": "Anmelden", "state": "machine", "source": "Sign in" }
    }
  }
}
```

Each locale carries a `value` (or `forms` for plural keys), a state, and an optional `source` recording the source string it was translated from (used to detect stale translations).

## Deterministic writes

Glotfile writes the file deterministically — **stable key order, fixed indent, one trailing newline** — so git diffs stay small and reviewable. The `config.format` block controls this:

- `indent` — spaces per level (default `2`)
- `sortKeys` — sort keys alphabetically (default `true`)
- `finalNewline` — end with a single newline (default `true`)

> **Info:** Why this matters — because writes are deterministic, re-running `glotfile export` with no real changes produces a **zero-line diff**. That's what makes Glotfile safe to run in CI.

## On load

When Glotfile reads the file it validates the structure (see Checks and Validation) and normalises values — for example, trimming surrounding whitespace — so legacy data folds to the same shape the UI produces on save. A malformed file fails loudly with a specific message rather than corrupting silently.

## Split storage: the `glotfile/` directory

For large catalogs, a single `glotfile.json` can reach several megabytes — making `git diff` slow, overflowing GitHub's render limit, and producing noisy conflicts when multiple branches add keys. The **split** layout breaks the catalog into a directory of smaller files, one per locale.

Run `glotfile split` once to convert an existing single file:

```
glotfile/
  config.json        # { $schema, version, config, glossary } — everything except keys
  keys.json          # per-key metadata: tags, notes, context, plurals, screenshots
  locales/
    en.json          # { "<key>": { value, state, ... } } for every key present in this locale
    fr.json
    ...
```

- **`config.json`** holds the configuration and glossary — the parts that change rarely.
- **`keys.json`** holds per-key metadata (tags, notes, context, plural config, screenshots) but **not** translation values. A tag edit touches only this file.
- **`locales/<locale>.json`** holds all translation values for one locale. An AI run on French rewrites only `fr.json`.

### What controls the layout

A `config.storage` field in the config selects how the catalog is saved:

| Value | Behaviour |
|---|---|
| `"single"` (or absent) | Write a single `glotfile.json` — the default for new projects. |
| `"split"` | Write the `glotfile/` directory. Set automatically by `glotfile split`. |

**Load auto-detects:** Glotfile checks for `glotfile/config.json` first (split), then `glotfile.json` (single), then starts from defaults. You never need to set this by hand — `glotfile split` sets it for you.

### Promotion is an explicit commit

There is no silent auto-promotion at a size threshold. Running `glotfile split` is a deliberate, one-time operation that produces a clearly-labelled commit. Once split, the CLI, web UI, and all export adapters work identically to the single-file layout — the in-memory state is unchanged.

## Related

- Configuration Reference · Keys and Locales · Review States
