# Editor

The Editor is a table of every key with the source string and each target language side by side. It's built to stay fast with thousands of keys (only visible rows are rendered).

## Working with keys

- **Add** a key (dot-notation name + source value).
- **Rename** a key inline.
- **Delete** a key.
- **Edit values inline** — click a cell, type, commit.

## Editing values

- Press **Enter** to commit an edit, **Escape** to cancel.
- Use **↑ / ↓** arrow keys to move between rows.
- Plural keys open a dedicated per-category form editor.

Each value shows a state badge you can toggle as you review (`machine` → `reviewed` / `needs-review`).

## Filtering and search

Free-text search plus state facets let you focus:

- **missing** — values with no content
- **machine** — AI translations not yet reviewed
- **needs-review** — flagged values (e.g. source changed)
- **reviewed** — human-approved values
- **needs attention** — any key with an open issue

You can also filter by **tag** and narrow to a single locale.

### Search syntax

By default the search box matches across **keys, values and context**. Scope it with a prefix, or use a regular expression — the `?` next to the box lists the same options:

| Type | Matches |
|---|---|
| `auth` | Everything: key names, translations, and context notes |
| `key:auth` | Key names only |
| `value:Sign in` | Translations only (every locale, including plural forms) |
| `context:button` | Context notes only |
| `/^auth\./` | A regular expression (wrap in `/…/`) |
| `value:/sign\s?in/` | A scoped regular expression |

Search is case-insensitive. A half-typed regex simply matches nothing until it's valid. The query is part of the URL, so a search survives a reload and can be shared. Press <kbd>/</kbd> to jump to the box and <kbd>Esc</kbd> to clear it.

## Per-key detail panel

Selecting a key opens its detail panel for metadata: **context**, **notes**, **tags**, **max length**, **screenshot**, the **skip-translate** flag, and the plural marker.

## Translating from the Editor

The translate action runs AI translation for the current selection/filter — the same engine as `glotfile translate`. Results come back as `machine` and never overwrite `reviewed` values.

## Exporting from the Editor

The export action opens a **preview** of exactly what `glotfile export` will write, before any files are touched. See Output Formats.

## Related

- Review States · Key Context and Metadata · Analytics · translate
