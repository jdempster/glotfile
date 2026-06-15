# `glotfile lint` and `glotfile check`

Two related commands for finding translation problems. Both are designed to run in CI.

- **`lint`** runs the rule engine against your catalog.
- **`check`** runs the same rules **and** verifies that your exported locale files are up to date. It's the all-in-one CI gate.

## `glotfile lint`

```bash
glotfile lint
```

```
auth.signIn.button
  error placeholder-mismatch de  placeholders differ from the source
  warn  max-length          fr  length 28 exceeds maxLength 20

✖ 1 error(s), 1 warning(s)
```

Exits `1` if there are any **errors**, or if warnings exceed `--max-warnings`.

### Options

| Option | Description |
|---|---|
| `--format <fmt>` | Output format: `text` (default), `json`, or `sarif`. |
| `--rule <list>` | Run only these rule ids, comma-separated. |
| `--locale <list>` | Restrict to these locales. |
| `--max-warnings <n>` | Exit `1` if warnings exceed `n` (errors always fail). |
| `--include-suppressed` | Also print findings hidden by suppressions, marked `(suppressed)`. |
| `--accept` | Suppress every current **warning** (narrow with `--rule`/`--locale`) and write the state file. |
| `--file`, `-f <path>` | Target a different state file. |

```bash
glotfile lint --rule placeholder-mismatch,icu-mismatch
glotfile lint --max-warnings 0          # treat all warnings as failures
glotfile lint --format sarif > glotfile.sarif
```

### Suppressions and `--accept`

A finding dismissed in the UI (or accepted here) is suppressed for that key + locale **until the key's source text changes**, then it resurfaces automatically. Adopting glotfile on a project with a noisy backlog:

```bash
glotfile lint --accept --rule identical-to-source   # accept the current ones
glotfile lint --include-suppressed                  # audit what's hidden
```

`--accept` never suppresses errors, and suppressions are committed with the state file so the whole team (and CI) agrees.

> **Info:** SARIF for code scanning — `--format sarif` emits SARIF 2.1.0 with each finding located at its line in `glotfile.json`. Upload it to GitHub code scanning to see findings inline on the PR. See Continuous Integration.

## `glotfile check`

```bash
glotfile check
```

`check` does everything `lint` does, **plus** re-exports every output in memory and compares it to what's on disk. A missing or out-of-date file is reported as an `output-stale` **error**:

```
lib/l10n/app_fr.arb
  error output-stale   output file is out of date; run `glotfile export`
```

It exits `1` on any error (a lint error *or* a stale export), and accepts `--format` like `lint`. If `glotfile.json` itself can't be parsed, `check` reports a single `load-error` and exits `1`.

> **Tip:** Use `check` as your one CI step — it catches both "the catalog has problems" and "someone forgot to run `glotfile export`" in a single command.

## Configuring rules

Rule severities, ignored keys, and dictionaries are set in `config.lint`. See Checks and Validation and Configuration Reference.

## Related

- Checks and Validation · Continuous Integration · export · Configuration Reference
