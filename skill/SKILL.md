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

## Three rules that prevent most mistakes

1. The state file is the source of truth — never hand-edit exported locale files.
2. Never translate strings yourself — always run `glotfile translate`.
3. Always build a new key's context before anything translates it.

Each is spelled out below.

## Rule 1 — the state file is the source of truth

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

## Rule 2 — never translate strings yourself; always run `glotfile translate`

**You do not author translations. Not one word, not one cell, not "just this obvious
one".** When translations need filling, the only correct action is to run `glotfile
translate` and let the tool produce them. Do not translate the text in your head, and do
not write your own wording in with `set --locale`.

This is not busywork you're delegating — glotfile is the better translator here. Its
`translate` pipeline feeds the model everything the project has taught it that you don't
have in front of you:

- `config.projectContext` — what the product is and how ambiguous terms are meant (the
  "feed a plant, not a social feed" kind of disambiguation).
- `config.localeInstructions` — per-locale register, formality, and terminology rules.
- the **glossary** — do-not-translate brand terms and pinned per-locale translations.
- each key's **`context`** — how that string is actually used in the code (from `scan` +
  `build-context`), which resolves short/ambiguous strings.
- placeholder, plural (ICU/CLDR), and markup-token handling, plus the correct review
  `state` on the result.

A translation you compose inline in this session sees none of that. It drifts from the
project's terminology and register, ignores the glossary, mishandles placeholders, and
lands unreviewed and inconsistent with the rest of the catalog. So: **to translate, call
`glotfile translate`** (`--key`, `--locale`, `--state needs-review`, or `--all` to scope
it) — see the task map below.

The excuses that feel reasonable and are still wrong:

- *"It's a single short string."* → `glotfile translate --key "<key>" --locale <code>`.
- *"I know this language well."* → you still don't have the glossary, the locale rules, or
  the key's context; the tool does.
- *"I'm the same model the provider would call."* → not with this project's system prompt,
  and your inline answer lands with the wrong review state.
- *"Lint says this cell is wrong, I'll just retype it."* → `glotfile clear <key> --locale
  <code>` then `glotfile translate`, or `glotfile translate --state needs-review`.

Use `set --locale` **only** to record one specific translation a *human* has already
decided (they gave you the exact string), never as a stand-in for translating yourself.

If `translate` can't run because a provider/API key isn't configured, that's a user setup
step (see "Provider/API keys" below) — surface it and stop; don't fall back to
hand-translating, and don't leave the cells filled with your own wording "for now".

## Rule 3 — always build a new key's context *before* it is translated

`context` is not optional polish — it's the input that makes the translation correct.
**Every newly created key gets its context generated before any translation runs.** New
keys arrive from `set --create`, a batch of `create` ops through `apply`, `import`, or
`sync`; all of them land with an empty `context`.

```sh
glotfile scan                  # index code references (re-run if the index is stale)
glotfile build-context         # fills only keys that are missing context
glotfile translate             # now each new key translates with its usage in view
```

Scope both AI steps to what you just added when you don't want a catalog-wide pass:
`glotfile build-context --key "cart.*"` then `glotfile translate --key "cart.*"`. A bare
`build-context` already skips keys that have context, so it's normally the right call
straight after adding keys — `--all` rebuilds every key's context and is rarely what you
want.

The order is the point: translate first and the machine translations were produced blind.
Adding context afterwards doesn't fix them — you'd have to `glotfile translate --all` to
redo the work. So never run `translate` on a key you just created without `build-context`
in between.

Two practical notes: `build-context` needs a prior `glotfile scan` and a configured AI
provider; and if the key isn't referenced in code yet (context comes back empty), wire it
up in the code first, or write a one-line `context` on the key yourself in the UI /
the key's `context` field — then translate.

## Work through the commands, not the raw file

On anything but a tiny catalog, **don't `Read` the whole state file or hand-edit its JSON.**
It can hold thousands of keys across many locales and is re-serialized deterministically,
so loading it wastes context and hand-edits are slow and easy to corrupt. Instead drive it
with the CLI:

- **Read / extract** with `glotfile get` (filter by key glob, `--search`, `--locale`, `--state`),
  `glotfile get --keys-only`, and `glotfile stats` (per-locale progress). All emit JSON.
- **Write** with `glotfile set` (source or `--locale` target), `glotfile set-state`,
  `glotfile clear`, `glotfile delete`, or `glotfile apply` (a JSON batch of edits applied in
  one atomic write).

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
| Find keys by their text (not name) | `glotfile get --search "<query>"` — `key:`, `value:`, `context:` scopes, `/regex/`, or no prefix for all three. E.g. `--search "value:Sign in"`, `--search "context:button"`, `--search "/^auth\\./"`. ANDs with globs/`--state`. See `references/cli-reference.md`. |
| Add a new string | `glotfile set <key> "<source text>" --create`, then **always** `glotfile scan` → `glotfile build-context --key "<key>"` → `glotfile translate --key "<key>"` (context first, never translate a new key without it). Finish with `glotfile export`. Leaving it untranslated for a later batch is fine — but that batch still runs `build-context` before `translate`. (Angular: add it in code, not here.) See `references/workflows.md`. |
| Edit an existing source string | `glotfile set <key> "<new text>"` — flips downstream translations to `needs-review`. Then `glotfile translate --state needs-review` re-translates just those. See `references/workflows.md`. |
| Set or fix one translation | `glotfile set <key> "<text>" --locale <code>` (lands `reviewed`; `--state` to override) — **only** for wording a human handed you. To fix a bad machine translation, `glotfile clear` it then `glotfile translate`. |
| Translate missing strings | Context first: `glotfile scan` → `glotfile build-context` (fills keys missing context) → `glotfile translate` (fills empties only). `--state needs-review` re-translates stale strings; `--all` redoes everything. Never hand-write the translations yourself. |
| Mark a review state | `glotfile set-state <key|glob> <reviewed\|needs-review\|machine> [--locale <list>]`. |
| Empty a translation (force re-translate) | `glotfile clear <key|glob> --locale <list>`. |
| Delete a key outright | `glotfile delete <key|glob>` — removes the key's source text **and every translation of it**. Only for a key the user asked you to remove, or one `prune` reports dead; it does not touch the call sites in their code, so check `glotfile scan` usage first. A glob only lists its matches until `--write`. Finish with `glotfile export`. |
| Make many edits at once | Pipe a JSON op list to `glotfile apply` — one atomic write; the right tool for bulk edits on a big file. |
| Write locale files | `glotfile export` |
| Find problems | `glotfile lint` (catalog issues) / `glotfile check` (lint + exports up to date) |
| Silence lint warnings that are false positives | Dismiss them: `glotfile lint --accept` bulk-suppresses the currently-shown warnings (narrow with `--rule <id>`/`--locale <code>`); the UI key panel's Lint section dismisses a single (rule, locale) on one key. Either way the dismissal auto-resurfaces when that key's source text changes — safe, not permanent. `glotfile lint --include-suppressed` audits what's hidden. |
| Stop lint flagging a whole key or area | Add a key glob to `config.lint.ignore` (e.g. `"legal.*"`) — every rule skips those keys, in both `glotfile lint`/`check` and the editor's live markers. Use for generated/legal/debug strings; prefer a dismissal for a one-off. See `references/schema.md`. |
| Turn a rule off (or change severity) for one language | Set `config.lint.localeRules.<locale>.<rule>` (e.g. `"en-gb": { "identical-to-source": "off" }`) — layered over `rules`, honored by `glotfile lint`/`check` and the editor. Use when a rule is noise for a whole locale, e.g. identical-to-source on English variants. Managed in the UI under Settings → Quality → Per-locale overrides. |
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
