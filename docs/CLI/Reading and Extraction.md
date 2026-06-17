# Reading and extraction

A real catalog can hold thousands of keys across many locales. Two commands let you read it **without loading the whole file** — both print JSON to stdout, so they pipe and parse cleanly. Reach for these instead of opening `glotfile.json`.

## `glotfile get`

Extract values for just the keys and locales you care about.

```bash
glotfile get "auth.*" --locale en,fr
```

| Option | Description |
|---|---|
| `<key-glob>…` | Keys to include, as positional globs (e.g. `auth.*`). Repeatable. Default: all keys. |
| `--key <glob>` | Another key glob, merged with the positionals. |
| `--locale <list>` | Locales to show, comma-separated. Default: every configured locale, **source included** (so you always have the reference text). |
| `--state <list>` | Only keys whose shown target locales are in these states: `source`, `missing`, `machine`, `needs-review`, `reviewed`. |
| `--fields <list>` | Cell fields to project: `value,state` (default), or `all` for the whole key entry (context/notes/tags/placeholders/plural). |
| `--keys-only` | Print just the matched key names, one per line — the cheapest overview. |
| `--format <fmt>` | `json` (default, nested) or `ndjson` (one flat row per cell). |
| `--file`, `-f <path>` | Target a different state file. |

The default output is keyed by key → locale → cell:

```json
{
  "auth.login": {
    "en": { "value": "Log in", "state": "source" },
    "fr": { "value": "Connexion", "state": "reviewed" },
    "de": { "value": "", "state": "missing" }
  }
}
```

### The translation work queue

`--state` filters **which keys appear** (by their target locales' state), while the source locale is always shown as the reference. So this is "every key still untranslated in German, with the English beside it":

```bash
glotfile get --locale en,de --state missing
```

Add `needs-review` to also pull the stale strings a source edit invalidated (`--state missing,needs-review`), and `--format ndjson` to stream a large result line by line.

## `glotfile stats`

Per-locale progress — `reviewed` / `machine` / `needs-review` / `missing` — plus totals. Use it to size up the work before a big translate, or to report completion.

```bash
glotfile stats                 # JSON
glotfile stats --format text   # a quick table
```

```
2480 key(s) · 16 target locale(s) · 73.4% translated, 41.2% reviewed
  de        88.1% translated  (reviewed 1641, machine 545, needs-review 0, missing 294)
  fr        61.0% translated  (reviewed 902, machine 611, needs-review 0, missing 967)
  …
```

| Option | Description |
|---|---|
| `--locale <list>` | Restrict to these comma-separated locales. |
| `--format <fmt>` | `json` (default) or `text`. |
| `--file`, `-f <path>` | Target a different state file. |

## Related

- Editing from the CLI · Review States · Keys and Locales
