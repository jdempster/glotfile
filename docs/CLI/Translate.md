# `glotfile translate`

AI-translates strings and writes the results back to `glotfile.json` as `machine` state. It never overwrites a `reviewed` value.

```bash
glotfile translate
```

With no flags, only **empty** values are filled — existing translations are left alone. Pass `--all` to re-translate every string. The flags below **combine** to narrow the run.

## Options

| Option | Description |
|---|---|
| `--all` | Re-translate every string, not just empty values (still never overwrites `reviewed`). |
| `--state <list>` | Re-translate only targets currently in these states (comma list of `missing`, `machine`, `needs-review`, `reviewed`). Default is `missing`. |
| `--estimate` | Print the batches, token counts and estimated cost without translating. |
| `--locale <list>` | Only these target languages, comma-separated (e.g. `fr,de`). Alias: `--locales`. |
| `--key <glob>` | Only keys matching a glob (e.g. `"auth.*"`). |
| `--file`, `-f <path>` | Target a different state file. |

```bash
glotfile translate                           # fill the gaps (only empty values)
glotfile translate --all                     # redo every non-reviewed value
glotfile translate --state needs-review      # re-do just the strings a source edit invalidated
glotfile translate --locale fr,de            # only French and German
glotfile translate --key "auth.*"            # only the auth namespace
glotfile translate --all --locale fr --key "checkout.*"
glotfile translate --estimate                # batches, tokens and cost — no API calls
```

The key use of `--state` is **`--state needs-review`**: when you edit a source string, its translations are flagged `needs-review` (stale). A plain `glotfile translate` skips them (they aren't empty) and `--all` would also overwrite good `reviewed` values elsewhere — `--state needs-review` re-translates exactly what the edit invalidated. See Editing from the CLI.

## What it prints

```
Translating 34 string(s)…
Wrote 34 machine translation(s).
```

Rejected translations (a dropped placeholder, a busted length limit) are reported and **skipped**, not written:

```
skip checkout.total @ de: placeholder {amount} is missing
```

See How Translation Works for the validation rules and Placeholders and ICU for what's checked.

## Credentials

`translate` is the only command that needs network access. Configure the provider in Settings (stored per-machine), and put credentials in your environment (a local `.env` works). See AI Providers.

> **Info:** Egress is logged — what's sent to the provider is recorded in the AI Log.

## Related

- How Translation Works · AI Providers · Review States
