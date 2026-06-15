# CLI Overview

Run `glotfile <command>` (or `node bin/glotfile.js <command>` from a checkout — see Installation).

| Command | What it does |
|---|---|
| serve (default) | Start the local web UI and open the browser. |
| get | Extract values (filtered) without loading the whole file — JSON out. |
| stats | Per-locale translation progress and totals. |
| set | Set a source string (marks the others stale) or one target translation. |
| set-state | Flip review state across keys/locales. |
| clear | Empty target value(s) so they re-translate. |
| apply | Apply a JSON batch of edits from stdin in one atomic write. |
| translate | AI-translate strings, writing results back to `glotfile.json`. |
| export | Write the locale files for every configured output. |
| lint | Report translation problems (states, placeholders, glossary, spelling…). |
| check | CI gate: lint **and** verify exported files are up to date. |
| import | Create `glotfile.json` from existing locale files. |
| build-context | AI-generate per-key context to improve translation (needs a prior scan). |
| scan | Index code references to keys (writes `.glotfile/usage.json`). |
| prune | Remove empty-source or unused keys (dry-run unless `--write`). |
| split | Convert `glotfile.json` into a reviewable `glotfile/` directory. |
| skill | Install the Claude Code skill for managing glotfile. |

Running `glotfile` with no command is the same as `glotfile serve`. Run `glotfile <command> --help` for a command's options.

`get`, `stats`, `set`, `set-state`, `clear` and `apply` are the precise, scriptable way to read and edit a large catalog from the command line — or from an AI agent. See Reading and Extraction and Editing from the CLI.

## Global option

Every command accepts `--file` (`-f`) to target a state file other than `./glotfile.json`:

```bash
glotfile translate --file packages/app/glotfile.json
glotfile export -f ./i18n/glotfile.json
```

## Exit codes

- `serve`, `translate`, `export`, `get`, `stats`, `set`, `set-state`, `clear` exit `0` on success.
- `apply` exits `1` if any operation fails; `set`/`set-state`/`clear` exit `1` on a bad key/locale.
- `lint` exits `1` when there are errors (or warnings over `--max-warnings`).
- `check` exits `1` when there are any errors (including out-of-date exports).

This is what makes `lint` and `check` usable as CI gates — see Continuous Integration.

## Credentials

Only translate needs network access or credentials. Glotfile reads them from the environment, including a local `.env` file in the project directory. See AI Providers.

## Related

- Web UI Overview — the same operations in the browser
- Configuration Reference
