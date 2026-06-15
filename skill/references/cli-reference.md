# glotfile CLI reference

Run via `npx glotfile <command>` (or `node bin/glotfile.js <command>` from a checkout).
Every command accepts the global flags:

- `-f, --file <path>` — state file to use (default: `./glotfile.json`).
- `-h, --help` — show help. `glotfile <command> --help` shows a command's options.

The state file is auto-detected: a `glotfile/` directory (split layout) wins over a
single `glotfile.json`.

## serve
`glotfile serve [--no-open]` — start the local web UI (the default command when none is
given). Opens a browser at a local URL; pass `--no-open` to skip launching the browser
(useful when driving glotfile headlessly). With `config.autoExport` on (the default),
serving re-exports to disk on every change. (Ignore the `--dev` flag shown in `--help`:
it's for developing glotfile itself — in that mode this process serves the API only and
the UI comes from a separate Vite server, so plain `serve` is what you want.)

## export
`glotfile export [--adapter <name>] [--watch]` — write the locale files for every
configured output in `config.outputs`.
- `--adapter <name>` — only export this adapter (e.g. `flutter-arb`, `laravel-php`).
- `--watch` — re-export whenever the state file changes.

Adapter names: `flutter-arb`, `laravel-php`, `i18next-json`, `vue-i18n-json`,
`gettext-po`, `apple-strings`, `apple-stringsdict`, `angular-xliff`, `rails-yaml`.

## translate
`glotfile translate [--all] [--state <list>] [--estimate] [--locale <list>] [--key <glob>] [--batch [--wait]]`
— AI-translate strings into the target locales and write the results back into the state file.
- By default only **empty** values are translated (existing translations are left alone).
- `--all` — re-translate every string, overwriting existing translations.
- `--state <list>` — re-translate only targets currently in these states (comma list of
  `missing`, `machine`, `needs-review`, `reviewed`). The key one is **`--state needs-review`**:
  it re-translates exactly the strings a source edit invalidated, without touching good
  reviewed translations. (`--all` is the same as listing every state; default is `missing`.)
- `--estimate` — print batch/token/cost estimates and translate nothing.
- `--locale fr,de` — restrict to these target locales (alias: `--locales`).
- `--key <glob>` — only keys matching the glob (e.g. `auth.*`).
- `--batch` — submit through the provider's batch API (~50% cheaper, runs asynchronously;
  **anthropic only**). Returns immediately with a pending batch; track and apply it with
  `glotfile batch` (see below). Reach for this when the user wants a large/cheap translate.
- `--wait` — with `--batch`, stay attached and poll until the batch finishes, then apply.

Requires a configured AI provider + API key in per-machine local settings.

## get
`glotfile get [<key-glob>…] [--key <glob>] [--locale <list>] [--state <list>] [--fields <list>] [--keys-only] [--format json|ndjson]`
— extract values from the catalog **without loading the whole file**. Prints JSON to stdout.
This is how you read a large catalog.
- Positional `<key-glob>` args (and/or `--key`) select keys (e.g. `auth.*`); default: all keys.
- `--locale <list>` — locales to show (default: every configured locale, **source included**
  so you always have the reference text).
- `--state <list>` — show only keys whose shown target locales are in these effective states:
  `source`, `missing` (empty/untranslated), `machine`, `needs-review`, `reviewed`. The source
  locale is always shown as the reference and doesn't gate the filter. So
  `glotfile get --locale en,de --state missing` is "every key still untranslated in `de`, with
  the English source beside it" — the translation work queue.
- `--fields <list>` — cell projection: `value,state` (default), add `updatedAt`, or `all` for
  the full key entry (context/notes/tags/placeholders/plural + values).
- `--keys-only` — print just the matched key names, one per line (the cheapest overview).
- `--format ndjson` — one flat `{key, locale, value, state}` row per line (stream-friendly for
  huge result sets); default is a nested JSON object `{ key: { locale: { value, state } } }`.

## stats
`glotfile stats [--locale <list>] [--format json|text]` — per-locale progress counts
(`reviewed` / `machine` / `needs-review` / `missing`) plus totals. Use it to size up the work
before a big translate or to report completion. JSON by default; `--format text` for a table.

## set
`glotfile set <key> [value] [--locale <code>] [--state <state>] [--create]`
— set a single value. The value is the positional, or `--value`, or piped on stdin (multi-line).
- **No `--locale` ⇒ the source string.** Editing it flips every downstream `reviewed`/`machine`
  translation to `needs-review` (it tells you how many) — then `glotfile translate --state
  needs-review` re-fills just those. This is the "write back the source language, mark the
  others stale" path.
- `--locale <code>` — set that target's value. It lands `reviewed` (a deliberate, authoritative
  edit); pass `--state machine|needs-review` to override.
- `--create` — create the key (scalar) if it doesn't exist yet (source writes only).
- Plural keys are edited via `apply` (`set-source-forms` / `set-forms`), not `set`.

## set-state
`glotfile set-state <key|glob> <state> [--locale <list>]` — flip the review state
(`machine` / `needs-review` / `reviewed`) of one key, or many via a glob, across locales
(default: every target locale). E.g. `glotfile set-state auth.* reviewed --locale fr` approves
all of `auth.*`'s French. Only cells that already have a value are touched.

## clear
`glotfile clear <key|glob> --locale <list>` — empty the given target value(s) so they read as
**untranslated**, which makes a plain `glotfile translate` refill them. `--locale` is required
and cannot be the source locale (edit that with `set`).

## apply
`glotfile apply [--dry-run] [--continue-on-error]` — read a JSON **array of write operations**
from stdin and apply them all in one load → mutate → save. Use this for bulk edits on a large
catalog: one file rewrite instead of N. Each op is one object:

```jsonc
[
  { "op": "set-source",       "key": "auth.title", "value": "Sign in" },
  { "op": "set-target",       "key": "auth.title", "locale": "fr", "value": "Connexion", "state": "reviewed" },
  { "op": "set-source-forms", "key": "cart.items", "forms": { "one": "{count} item", "other": "{count} items" } },
  { "op": "set-forms",        "key": "cart.items", "locale": "pl", "forms": { "one": "…", "few": "…", "many": "…", "other": "…" } },
  { "op": "set-state",        "key": "auth.title", "locale": "de", "state": "reviewed" },
  { "op": "clear",            "key": "auth.title", "locale": "es" },
  { "op": "create",           "key": "home.cta",   "value": "Get started" }
]
```

- **Atomic by default:** if any op fails, nothing is written (the file is untouched) and the
  command exits non-zero, reporting which op failed.
- `--continue-on-error` — apply the ops that succeed, skip the ones that fail, and save anyway.
- `--dry-run` — report what would change without writing.
- Prints `{ applied, keysTouched, saved, dryRun, errors }`.

## lint
`glotfile lint [--format text|json|sarif] [--locale <list>] [--rule <list>] [--max-warnings <n>] [--include-suppressed] [--accept]`
— check the catalog for problems (placeholder mismatches, length, glossary violations,
spelling, identical-to-source, …).
- `--max-warnings <n>` — exit non-zero if warnings exceed n (for CI).
- `--accept` — suppress all current warnings (narrow with `--rule`/`--locale`); each
  suppression expires automatically when its key's source text changes.
- `--include-suppressed` — also show findings hidden by suppressions.

## check
`glotfile check [--format text|json|sarif]` — lint the catalog **and** verify the
exported files on disk are up to date. Use in CI to catch a state file that was changed
without re-exporting. Exits non-zero on any error.

## import
`glotfile import --format <name> [--source <dir>] [--source-locale <code>] [--locales <list>] [--cldr] [--force]`
— create `glotfile.json` from a project's existing locale files. See
`references/workflows.md` for the onboarding flow.

Every export adapter is also importable. Auto-detect caveats: an iOS project with both
`.strings` and `.stringsdict` auto-detects as `apple-strings` (use an explicit
`--format apple-stringsdict` for the plural table — it builds a separate catalog);
flat i18next `<lng>.json` files look like vue-i18n, so they need an explicit
`--format i18next-json` (the `public/locales/<lng>/<ns>.json` layout auto-detects).
- `--source <dir>` — directory to import from (default: the state file's directory).
- `--source-locale <code>` — which locale is the source of truth.
- `--locales <list>` — comma-separated locales to import (default: every locale found).
- `--cldr` — expand CLDR plural forms.
- `--force` — overwrite an existing `glotfile.json`.

## sync
`glotfile sync [--format <name>] [--source <dir>] [--source-locale <code>] [--locales <list>] [--cldr] [--prune] [--dry-run]`
— re-read the locale files and **merge** them into the existing catalog. Use this to pull
re-extracted strings in without losing glotfile-owned data (the resync counterpart to the
one-time `import`). Format is auto-detected if omitted.
- New keys are added; a changed source value bumps the key and flips its translations to
  `needs-review` (their text is kept); empty target locales are filled from any non-empty
  incoming translation (existing translations are never overwritten).
- Glossary, key context/notes/descriptions, config, and translations are preserved.
- Removed keys (present locally, gone from the import) are **reported only** — pass
  `--prune` to delete them.
- `--dry-run` prints the changeset (added / source-changed / adopted / removed) and writes
  nothing.
- For Angular, `sync` also rebuilds `.glotfile/usage.json` from the source locations in
  `messages.xlf`.

## build-context
`glotfile build-context [--all] [--key <glob>] [--limit <n>] [--since <date>] [--batch]` —
AI-generate per-key context (where/how a string is used) to improve translation quality.
**Requires a prior `glotfile scan`** to index code references. `--batch` submits through the
batch API (anthropic only), like `translate --batch`.

## scan
`glotfile scan` — index the codebase's references to translation keys, writing
`.glotfile/usage.json`. Feeds `build-context` and `prune --unused`. For Angular
(`angular-xliff`), the regex scanner can't see content-hash ids, so `scan` instead rebuilds
the index from the source locations recorded in `messages.xlf`.

Tune it via `config.scan` when the heuristic misses (`include`/`exclude` file globs,
Flutter `accessors`, custom `patterns` regexes, and **`keep`** — see below). See
`references/schema.md` for the full shape.

## prune
`glotfile prune (--empty-source | --unused) [--write]` — remove keys. **Dry-run (lists
only) unless `--write` is given.**
- `--empty-source` — keys whose source value is empty.
- `--unused` — keys with no code reference (runs a scan first so the result is current).
  For Angular, "unused" is computed from a fresh extraction (keys gone from `messages.xlf`),
  so run `ng extract-i18n` before pruning.

`--unused` is heuristic. A key referenced only dynamically or through a wrapper the scanner
doesn't recognise can show up as a false positive. **Don't delete a key you know is live —
add its glob to `config.scan.keep`** (keys always treated as used) and re-run. `keep` is also
the right home for keys consumed by code the scanner can never see (framework internals,
vendored packages, server-driven UIs).

## split
`glotfile split` — convert a single `glotfile.json` into a `glotfile/` directory
(`config.json`, `keys.json`, `locales/<code>.json`). Produces smaller, more reviewable
git diffs on large catalogs. All commands work with either layout.

## skill
`glotfile skill [--print] [--force]` — install this Claude Code skill into the current
repo's `.claude/skills/glotfile/`. `--print` writes `SKILL.md` to stdout instead;
`--force` overwrites an existing install.

## batch
`glotfile batch [status|apply|cancel]` — manage a pending batch translation that was
submitted with `glotfile translate --batch`. The batch runs server-side; this command
checks on it from a later session (the handle is stored locally).
- `status` (default) — show the pending batch's progress.
- `apply` — fetch the finished results and write the translations into the state file
  (this happens automatically once the batch has finished).
- `cancel` — cancel the pending batch and discard its handle.
