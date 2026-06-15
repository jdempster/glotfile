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

## Per-key detail panel

Selecting a key opens its detail panel for metadata: **context**, **notes**, **tags**, **max length**, **screenshot**, the **skip-translate** flag, and the plural marker.

## Translating from the Editor

The translate action runs AI translation for the current selection/filter — the same engine as `glotfile translate`. Results come back as `machine` and never overwrite `reviewed` values.

## Exporting from the Editor

The export action opens a **preview** of exactly what `glotfile export` will write, before any files are touched. See Output Formats.

## Related

- Review States · Key Context and Metadata · Analytics · translate
