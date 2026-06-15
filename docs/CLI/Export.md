# `glotfile export`

Writes the locale files for every output configured in `config.outputs`, using the adapters you've set up.

```bash
glotfile export
```

```
Exported 8 file(s).
```

## Options

| Option | Description |
|---|---|
| `--adapter <name>` | Export only the outputs using this adapter. |
| `--watch` | Re-export whenever the state file changes (stays running). |
| `--file`, `-f <path>` | Target a different state file. |

```bash
glotfile export --adapter laravel-php   # just the Laravel files
glotfile export --watch                 # re-export on every change
```

## Warnings

Where a conversion would be lossy (a construct a target format can't represent), export prints a **warning** and writes the best safe output rather than corrupting the file:

```
warning [icu-unsupported] cart.items @ de: plural select not representable; wrote fallback
```

See Placeholders and ICU.

## Zero-diff guarantee

Because `glotfile.json` is written deterministically, re-running `export` with no real changes produces a **zero-line diff**. That makes it safe to run in CI to confirm your locale files are up to date:

```bash
glotfile export
git diff --exit-code   # non-zero if exports drifted
```

> **Tip:** Prefer `check` in CI — `glotfile check` re-exports in memory and fails if any output file is missing or stale — no `git diff` dance required. See Continuous Integration.

## Related

- Output Formats · Placeholders and ICU · lint and check · Continuous Integration
