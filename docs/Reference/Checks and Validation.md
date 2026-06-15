# Checks and Validation

Glotfile validates your catalog two ways: **live in the UI** as you edit, and via the **`lint` / `check`** commands for CI. Both look for the same kinds of problem.

## Lint rules

`glotfile lint` runs these rules. Each has a default severity you can override in `config.lint.rules`.

| Rule id | Default | Catches |
|---|---|---|
| `empty-source` | **error** | A key whose source value is empty. |
| `empty-translation` | **error** | A target value that's missing or whitespace-only. |
| `placeholder-mismatch` | **error** | Translation placeholders differ from the source. |
| `icu-mismatch` | **error** | One side is an ICU plural/select and the other isn't. |
| `glossary-violation` | **error** | A do-not-translate term is altered, or a forced Glossary translation is missing. |
| `max-length` | warn | A value longer than the key's max length. |
| `identical-to-source` | warn | A translation identical to the source string. |
| `whitespace` | warn | Leading/trailing whitespace that differs from the source. |
| `spelling` | warn | A word the locale's dictionary doesn't recognise. |

`glotfile check` adds one more, by re-exporting and comparing to disk:

| Rule id | Default | Catches |
|---|---|---|
| `output-stale` | **error** | An exported file is missing or out of date — run `glotfile export`. |

## Configuring rules — `config.lint`

Editable in **Settings → Quality checks**, or by hand:

```json
"lint": {
  "rules": { "identical-to-source": "off", "max-length": "error" },
  "ignore": ["legal.*", "debug.*"],
  "spelling": { "locales": { "pt-BR": "pt" } }
}
```

| Field | Meaning |
|---|---|
| `rules` | Override a rule's severity: `"error"`, `"warn"`, or `"off"`. |
| `ignore` | Globs of keys to skip entirely. |
| `spelling.locales` | Map a locale to a different dictionary id (e.g. use the `pt` dictionary for `pt-BR`). |

Rule configuration applies everywhere at once: the live editor checks, the Analytics release gate, and `glotfile lint`/`check`. The `spelling` rule accepts Glossary terms and the custom dictionary (`config.spelling.customWords`) automatically.

> **Note:** Spelling needs a dictionary — the `spelling` rule only runs for locales that have a dictionary available. Locales without one are skipped with a notice.

## Dismissing a single finding

Sometimes a warning is just wrong for one string — "Logo" really is "Logo" in French. Dismiss the finding from Analytics (or the key's detail panel) and it's suppressed for that key + locale **until the source text changes**, at which point it resurfaces automatically. Suppressions are stored on the key in the state file, so they're shared with your team and reviewable in diffs.

- `glotfile lint --accept [--rule <list>] [--locale <list>]` bulk-suppresses the current warnings — useful when adopting glotfile on an existing project.
- `glotfile lint --include-suppressed` shows suppressed findings (marked); Analytics has a matching "Suppressed (n)" drawer with per-finding restore.
- Errors are never bulk-accepted; fix those instead.

## Severities and exit codes

- **error** → fails `lint`/`check` (exit `1`).
- **warn** → reported; fails only if over `--max-warnings`.
- **off** → not run.

See lint and check for `--format` (text / json / sarif), `--rule`, `--locale`, and `--max-warnings`, and Continuous Integration for wiring it up.

## Live UI checks

The Editor continuously surfaces issues — missing values, placeholder mismatches, length and glossary violations, and spelling — so you fix them as you work. The **needs-attention** filter shows every key with an open issue.

## Related

- lint and check · Continuous Integration · Placeholders and ICU · Configuration Reference
