---
name: glotfile
description: Use whenever working in a repo that contains a glotfile.json file or a glotfile/ directory, or when the user asks to add, edit, translate, export, import, lint, or prune localized strings, manage locales/i18n/translations, onboard or set up a translation catalog, work with a translation glossary, or run any `glotfile` command — even if they don't say "glotfile" by name. glotfile is a local-first, git-native translation manager whose committed state file is the single source of truth for every locale.
---

# Managing glotfile

Glotfile keeps every translatable string for a project in one committed state file —
`glotfile.json` (or a `glotfile/` directory when storage is split). A local web UI,
a CLI, and pluggable AI providers all read and write that one file; platform locale
files (Flutter ARB, Laravel PHP, i18next/vue-i18n JSON, gettext `.po`, Apple
`.strings`/`.stringsdict`, Angular XLIFF, Rails YAML) are **generated from it on export**.

## The one rule that prevents most mistakes

**The state file is the single source of truth. Exported locale files are generated
output — never hand-edit them.** Editing `lib/l10n/app_fr.arb` or `resources/lang/fr/`
directly is wasted work: the next `glotfile export` overwrites it. Change the source
string in glotfile, then export.

To make a change:
1. Edit the **state file** (or run a `glotfile` command, or use the UI).
2. Run `glotfile export` to regenerate the locale files.
3. Commit both the state file and the regenerated outputs.

**Exception — Angular (`angular-xliff`):** source strings live in the code and
`ng extract-i18n` generates `messages.xlf`; glotfile owns only the translations. New
keys cannot be added in glotfile (trans-unit ids are content hashes). After the first
`import`, resync with `glotfile sync` (never `import --force` — it discards glossary and
context) — see "Angular projects" in `references/workflows.md` for the
extract → sync → translate → export loop.

## Work through the commands, not the raw file

On anything but a tiny catalog, **don't `Read` the whole state file or hand-edit its JSON.**
It can hold thousands of keys across many locales and is re-serialized deterministically,
so loading it wastes context and hand-edits are slow and easy to corrupt. Instead drive it
with the CLI:

- **Read / extract** with `glotfile get` (filter by key glob, `--locale`, `--state`),
  `glotfile get --keys-only`, and `glotfile stats` (per-locale progress). All emit JSON.
- **Write** with `glotfile set` (source or `--locale` target), `glotfile set-state`,
  `glotfile clear`, or `glotfile apply` (a JSON batch of edits applied in one atomic write).

These are the supported, stable way to inspect and change a glotfile from the CLI — prefer
them. Reach for a raw-file edit only for something no command covers, and then match the
deterministic format (`references/schema.md`). (Reading `config` directly is still fine —
it's small; see below.)

## Before you touch anything: discover the project's actual config

Do not assume the locales, providers, or output formats — read them. They live in the
state file's `config` block.

- Single-file layout: read `glotfile.json` → `.config`.
- Split layout: read `glotfile/config.json` → `.config`.

`config.sourceLocale`, `config.locales`, and `config.outputs[]` tell you what languages
exist and where exports land. Match the project; don't introduce a new locale or adapter
unless asked.

If `config.projectContext` or `config.localeInstructions` are set, they steer AI translation
(a project-wide description and per-locale rules, both folded into the model's system prompt).
Read and respect them before translating — they hold the project's terminology and register
decisions. See `references/schema.md`.

## Task → tool map

| You want to… | Do this |
| --- | --- |
| Size up the catalog / what's left | `glotfile stats` (per-locale translated/reviewed/missing counts). |
| Extract specific values | `glotfile get [<key-glob>…] [--locale <list>] [--state <list>]` — JSON out; the way to read a large catalog. `--keys-only` for just names. |
| Add a new string | `glotfile set <key> "<source text>" --create`, then `glotfile translate` + `glotfile export`. (Angular: add it in code, not here.) See `references/workflows.md`. |
| Edit an existing source string | `glotfile set <key> "<new text>"` — flips downstream translations to `needs-review`. Then `glotfile translate --state needs-review` re-translates just those. See `references/workflows.md`. |
| Set or fix one translation | `glotfile set <key> "<text>" --locale <code>` (lands `reviewed`; `--state` to override). |
| Translate missing strings | `glotfile translate` (fills empties only). `--state needs-review` re-translates stale strings; `--all` redoes everything. |
| Mark a review state | `glotfile set-state <key|glob> <reviewed\|needs-review\|machine> [--locale <list>]`. |
| Empty a translation (force re-translate) | `glotfile clear <key|glob> --locale <list>`. |
| Make many edits at once | Pipe a JSON op list to `glotfile apply` — one atomic write; the right tool for bulk edits on a big file. |
| Write locale files | `glotfile export` |
| Find problems | `glotfile lint` (catalog issues) / `glotfile check` (lint + exports up to date) |
| Bootstrap from existing locale files | `glotfile import --format <adapter>` (or bare `glotfile import` to auto-detect) — see `references/workflows.md`. Every export adapter is importable. |
| Remove dead keys | `glotfile prune --unused` / `--empty-source` (dry-run unless `--write`). |
| Stop a live key being pruned | Add its glob to `config.scan.keep` (keys always counted as used). Never delete a `prune --unused` hit you know is live — `keep` it. See `references/schema.md`. |
| Exclude a key from translation | Set `skipTranslate: true` on the key (brand names, code, copy that must stay in the source language) — `translate` skips it and lint won't flag it as missing. |
| Enforce term translations | Glossary — see `references/workflows.md`. |

## Reference files — read the one you need

- `references/cli-reference.md` — every command, its flags, and when to reach for it.
- `references/schema.md` — the shape of `glotfile.json`: `Config`, `KeyEntry`, plurals,
  placeholders, locale states. Read before editing the file by hand.
- `references/workflows.md` — step-by-step recipes: adding/editing strings, onboarding a
  repo via `import`, populating the glossary, building context for better translations.
- `references/conventions.md` — guardrails and the mental model. Read this if you are
  unsure whether an action fights the tool.

## Provider/API keys

AI provider settings and API keys live in **per-machine local settings** (not the
committed config), so they are absent in fresh clones. If a `translate` or
`build-context` run fails for a missing key/provider, that is a configuration step for
the user — don't invent keys or commit them.
