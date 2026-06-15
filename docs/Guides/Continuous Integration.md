# Continuous Integration

Glotfile is built to run in CI so a broken or stale translation state can't reach `main`. The key command is `glotfile check`; `glotfile lint` gives you finer control.

## The one-liner

Add a single step that validates the catalog **and** confirms exports are up to date:

```bash
glotfile check
```

`check` exits non-zero if there are any errors — a lint error *or* an `output-stale` finding (someone changed copy but forgot to run `glotfile export`). That one command is usually all you need.

> **Tip:** Why `check` over `export` + `git diff` — `check` re-exports in memory and compares to disk, so you don't need to write files and diff. It also catches catalog problems (placeholder mismatches, empty translations, glossary violations) that a diff wouldn't.

## What gets gated

| Failure | Caught by | Default severity |
|---|---|---|
| Empty source / empty translation | `lint`, `check` | error |
| Placeholder or ICU mismatch | `lint`, `check` | error |
| Glossary violation | `lint`, `check` | error |
| Length / identical-to-source / whitespace / spelling | `lint`, `check` | warn |
| Exported file missing or stale | `check` only | error |

Tune severities in `config.lint` — see Checks and Validation.

## GitHub Actions

```yaml
name: i18n
on: [pull_request]
jobs:
  glotfile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx glotfile check
```

> **Note:** No credentials needed in CI — `check` and `lint` are fully offline — only translate needs an API key. Don't put translation secrets in CI just to validate.

## Failing on warnings

By default only errors fail the build. To hold the line on warnings too:

```bash
glotfile lint --max-warnings 0
```

`lint` exits `1` when warnings exceed the threshold. Combine with `check` (run both) if you want stale-export gating *and* zero warnings.

## Code scanning (SARIF)

Emit SARIF and upload it so findings appear inline on the PR, each located at its line in `glotfile.json`:

```yaml
      - run: npx glotfile lint --format sarif > glotfile.sarif
        continue-on-error: true
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: glotfile.sarif
```

`--format json` is also available for custom tooling.

## Scoping a run

```bash
glotfile lint --rule placeholder-mismatch,icu-mismatch   # only the critical rules
glotfile lint --locale fr,de                             # only some locales
```

## Related

- lint and check · Checks and Validation · export · Translation Workflow
