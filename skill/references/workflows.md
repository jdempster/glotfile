# glotfile workflows

Recipes for the common jobs. All of them follow the same loop: **change the state file →
`glotfile export` → commit both.** Prefer the CLI/UI over hand-editing; edit by hand only
when no command fits (then match the deterministic format — see `references/schema.md`).

Two constants across every recipe below: **translations are produced by `glotfile
translate`, never hand-written by you**, and **a new key gets `glotfile build-context`
before anything translates it** (`scan` → `build-context` → `translate`).

## Add a new string

1. Pick a key name that matches the project's existing convention (look at sibling keys —
   dotted `auth.login.title`, flat, etc.).
2. Create it with its source value:
   ```sh
   glotfile set cart.empty.title "Your cart is empty" --create
   ```
3. Wire the key up in the app code using the project's i18n accessor, so there's a usage
   site for context to be read from.
4. **Generate its context, then translate — in that order, always.** Never run `translate`
   on a key created moments ago whose `context` is still empty.
   ```sh
   glotfile scan                                 # index code references (if not fresh)
   glotfile build-context --key "cart.empty.title"   # AI writes a short context from usage
   glotfile translate --key "cart.empty.title"       # fill the other locales, context-aware
   ```
   `build-context` needs a scan index and an AI provider; `context` measurably improves
   translation quality, especially for short or ambiguous strings, and a translation
   produced without it can't be repaired by adding context later — only by
   `glotfile translate --all`. (You can also set `context` by hand in the UI or the key's
   `context` field — see `references/schema.md`; do that when the key isn't referenced in
   code yet and `build-context` has nothing to read.)

   Deferring the translation to a later batch is fine. Deferring the *context* is not — the
   batch run is then `scan` → `build-context` → `translate`, same order.

   **Do not write the translations yourself** — not even a one-word label in a language you
   know. `glotfile translate` is the translator; you drive it (rule 2 in `SKILL.md`).
5. `glotfile export` to write the locale files, then commit.

Adding many at once? Batch them through `glotfile apply` (a list of `create` ops) — one
write instead of one per key — then run the same `scan` → `build-context` → `translate`
sequence over the batch (scope with `--key "<glob>"`). For a **plural** message, create it then set its forms via
`apply` (`set-source-forms`), or hand-edit the key with a `plural: { "arg": "count" }`
marker and `forms` instead of `value` (see `references/schema.md`). Use ICU placeholders
like `{count}` and keep them identical across locales — the lint placeholder rule enforces
this.

## Edit an existing source string

1. Write the new source value:
   ```sh
   glotfile set checkout.title "Review your order"
   ```
   This flips every `reviewed`/`machine` translation of that key to `needs-review` (it
   reports how many) — they're now stale.
2. Re-translate just the stale ones:
   ```sh
   glotfile translate --state needs-review
   ```
   (Scope with `--key "checkout.*"` if you only want this key.) Use `--state needs-review`,
   **not** `--all` — a plain `glotfile translate` fills only *empty* values so it would skip
   the stale-but-non-empty ones, while `--all` would also overwrite good `reviewed`
   translations elsewhere. `--state needs-review` re-does exactly what the edit invalidated.
3. `glotfile export`, then commit.

Editing many sources at once? Batch the `set-source` ops through `glotfile apply`, then run
the single `glotfile translate --state needs-review`. Never edit a translation in an
exported file to "fix" it — fix it in the catalog (`glotfile set <key> --locale <code>`,
which lands `reviewed`) and re-export.

## Onboard a repo that already has locale files

1. Identify the existing format and pick the matching adapter (e.g. a Laravel app with
   `resources/lang/{locale}/` → `laravel-php`; a Flutter app with `app_{locale}.arb` →
   `flutter-arb`; an Angular app with `messages.xlf` → `angular-xliff`; a Rails app
   with `config/locales/*.yml` → `rails-yaml`). Every export adapter is importable;
   a bare `glotfile import` auto-detects the layout.
2. `glotfile import --format <adapter> --source <dir> --source-locale <code>` — this reads
   the existing files and writes a `glotfile.json`. Add `--cldr` if plurals use CLDR
   forms; `--force` to overwrite an existing state file.
3. Review the generated `config.outputs` so a subsequent `glotfile export` writes back to
   the same paths the project already uses.
4. `glotfile scan` then `glotfile build-context` to give every imported key its usage
   context — **before** the first `glotfile translate`. An import creates the whole catalog
   as new keys with empty context, so this is exactly the case the context-first rule is
   for: translating first means translating the entire catalog blind.

## Angular projects (angular-xliff) — the source flow is inverted

In Angular i18n the **code is the source of truth for source strings**: `ng extract-i18n`
generates `messages.xlf` (trans-unit ids are content hashes), so you cannot add a key by
editing glotfile — add the string in the template/`$localize` and re-extract. Glotfile
owns the *translations*, not the source catalog:

**First time:** `glotfile import --format angular-xliff` to create `glotfile.json` from
`messages.xlf`.

**Every time after that, resync — don't re-import:**

1. Mark strings in code (`i18n`/`i18n-<attr>` attributes, `$localize` tagged templates).
2. `ng extract-i18n` (check `angular.json`/package scripts for the configured output
   path) to regenerate `messages.xlf`.
3. `glotfile sync --dry-run` to preview the changeset (added / source-changed / removed),
   then `glotfile sync` to apply. `sync` **merges** into the existing catalog: new strings
   are added, edited source text bumps the key and flags its translations `needs-review`,
   and — crucially — your glossary, key context/notes, descriptions, and existing
   translations are preserved (unlike `import --force`, which rebuilds the file and loses
   them). Removed keys are only reported; add `--prune` to delete them once you've
   confirmed they're real deletions and not hash churn (see below).
4. `glotfile build-context` for the keys the sync just added (`scan` first — for Angular it
   rebuilds the usage index from `messages.xlf`), then `glotfile translate` to fill the
   missing locales, then `glotfile export`. The context step is not optional: a `sync` that
   adds keys adds them with empty context. Export writes only `messages.<locale>.xlf` files
   (`skipSourceLocale`); it never touches `messages.xlf` — that file belongs to the Angular
   extractor.

**Hash churn — why `--prune` needs care.** trans-unit ids are content hashes of the
source text, so editing an English string produces a *new* id (the old one disappears).
`sync` sees that as one removed key + one added key, and the old key's translations and
context don't carry over to the new id. Prefer custom stable ids (`i18n="@@myId"`) where
churn matters: then a source edit is an in-place `source-changed`, keeping context and
flagging translations for re-check. Review `sync --dry-run` before `--prune`.

**Scan / unused for Angular.** The regex code scanner can't find hashed keys, so `glotfile
scan` rebuilds the usage index from the source locations Angular records in `messages.xlf`
(the UI "used in" tree works from these). `prune --unused` is driven by re-extraction —
a key absent from a fresh `messages.xlf` is the authoritative "unused" signal — so run
`ng extract-i18n` before pruning.

Markup placeholders (`<x id="START_TAG_STRONG"/>` …) appear in glotfile values as
`{START_TAG_STRONG}`-style tokens with their original attributes kept in the key's
`placeholders` metadata; keep the tokens intact in translations and export reproduces
the exact `<x/>` elements.

## Populate the glossary

The glossary constrains how particular terms are translated across the catalog; the lint
`glossary` rule flags violations. Each entry:

```jsonc
{
  "term": "Glotfile",
  "doNotTranslate": true,            // keep verbatim in every locale
  "caseSensitive": true,
  "notes": "Product name"
}
```

Or pin specific translations:

```jsonc
{
  "term": "cart",
  "translations": { "fr": "panier", "de": "Warenkorb" },
  "notes": "Use the e-commerce sense, not 'chariot'"
}
```

Add entries to the top-level `glossary` array. After adding them, `glotfile lint` will
flag existing translations that don't comply; `glotfile translate --all` re-translates
with the glossary applied.

## Context before translation — the standing order

`glotfile scan` (index code references) → `glotfile build-context` (AI writes a short
`context` per key from how it's used in code) → `glotfile translate`. Keys with good
`context` translate far more accurately, especially short or ambiguous strings.

Run those three in that order **every time a key is new** — created by `set --create`, by
`apply` `create` ops, by `import`, or by `sync`. A bare `glotfile build-context` only
touches keys that are missing context, so it is cheap to put in front of any `translate`
and it never disturbs the context you already have (`--all` does — reserve it for a
deliberate rebuild).

Skipping it is not a shortcut, it's rework: a value translated without context is already
in the catalog as `machine`, and adding the context afterwards changes nothing until you
`glotfile translate --all` over it.

## Work a large catalog from the CLI

A real catalog can be thousands of keys across a dozen-plus locales. Don't read or
hand-edit the file — query and edit it surgically.

1. **Survey:** `glotfile stats` for per-locale completion; `glotfile stats --format text`
   for a quick table. `glotfile get --keys-only --key "<glob>"` to enumerate a namespace.
2. **Pull only what you need:** the source plus the cells still to do —
   ```sh
   glotfile get --locale en,de --state missing,needs-review --key "checkout.*"
   ```
   gives the English source beside every `de` cell that's empty or stale for `checkout.*`.
   Add `--format ndjson` when the result is large and you want to stream/grep it.
3. **Fill the gaps with `translate`, scoped:** `glotfile build-context --key "checkout.*"`
   (after `scan`, for any key still without context) then
   `glotfile translate --locale de --key "checkout.*"` fills the empties; after a source
   edit, `glotfile translate --state needs-review` re-does the stale ones. This is how
   translations get written — never by you typing target-language strings into `apply`.
4. **Make human-decided edits as one batch.** When a person has supplied the exact wording
   (a reviewer's corrections, a client's approved glossary of labels), build a JSON op list
   and pipe it in — one atomic write, no diff churn, no per-edit race:
   ```sh
   cat <<'JSON' | glotfile apply
   [
     { "op": "set-target", "key": "checkout.title", "locale": "de", "value": "<wording the reviewer gave you>", "state": "reviewed" },
     { "op": "set-state",  "key": "checkout.pay",   "locale": "de", "state": "reviewed" }
   ]
   JSON
   ```
   Preview first with `glotfile apply --dry-run`. On any bad op the whole batch is rejected
   (nothing written) unless you pass `--continue-on-error`. Then `glotfile export` and commit.

Rule of thumb: **`get` to read, `set`/`apply` to write what a human decided, `build-context`
then `translate` for everything that needs translating** — reach for a raw-file edit only
when no command covers what you need.
