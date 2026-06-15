# Glotfile

A local-first, git-native translation manager. All your app's copy lives in one
JSON file you commit to your repo, you edit and AI-translate it through a local
web UI, and you export to whatever locale formats your apps consume — no SaaS,
no hosted database, nothing leaves your machine except the AI calls you choose
to make.

**[glotfile.dev](https://glotfile.dev)** · [Docs](https://glotfile.dev/docs/) · [npm](https://www.npmjs.com/package/glotfile)

- **One source of truth** — every string and translation lives in `glotfile.json`, committed alongside your code. Versioning, review, and rollback come from git. For large catalogs, run `glotfile split` to store the catalog as a `glotfile/` directory with one file per locale — so a one-locale change is a one-file `git diff` instead of a multi-megabyte one. The in-app experience is identical.
- **Local web UI** — run one command, edit in the browser, changes save straight back to the file.
- **AI translation** — fill in missing languages with Anthropic, OpenAI, AWS Bedrock, OpenRouter, Claude Code, or a local Ollama model, using per-key context, a glossary, and screenshots.
- **Export anywhere** — generate Flutter ARB, Laravel PHP, i18next JSON, gettext `.po`, and Apple `.stringsdict` from the same source.

---

## Requirements

- Node **^20.19.0 || >=22.12.0**

## Getting started

Glotfile runs with no install via `npx`:

```bash
npx glotfile
```

That starts a local server bound to `127.0.0.1`, opens your browser, and — if
there's no `glotfile.json` in the current directory yet — starts from sensible
defaults and writes the file as soon as you make your first edit.

> Working on Glotfile itself? Clone the repo, then `npm install` and `npm run dev`
> to run the Vite UI with hot-reload alongside the server. `npm run build` followed
> by `node bin/glotfile.js` runs the built CLI exactly like the published `glotfile`.

---

## The state file: `glotfile.json`

Everything is derived from this one file at the root of your project. It's
written deterministically (stable key order, fixed indent, one trailing
newline) so git diffs stay small and reviewable. A fresh file looks like this:

```json
{
  "version": 2,
  "config": {
    "sourceLocale": "en",
    "locales": ["en"],
    "outputs": [
      { "adapter": "flutter-arb", "path": "lib/l10n/app_{locale}.arb" },
      { "adapter": "laravel-php", "path": "lang/{locale}/{namespace}.php" }
    ],
    "ai": { "provider": "anthropic", "model": "claude-opus-4-8", "endpoint": null, "region": null, "batchSize": 25 },
    "format": { "indent": 2, "sortKeys": true, "finalNewline": true },
    "spelling": { "customWords": [] }
  },
  "glossary": [],
  "keys": {}
}
```

- **`sourceLocale` / `locales`** — the language you author in, and every language you maintain.
- **`keys`** — a flat map of dot-notation keys (e.g. `auth.signIn.button`), each with a value per locale, a review `state`, and optional metadata (context, tags, max length, screenshot, notes).
- **`outputs`** — where exported locale files are written, one entry per format (see [Output formats](#output-formats)).
- **`ai`** — which model translates and how (see [AI translation](#ai-translation)).
- **`glossary`** — do-not-translate terms and forced per-locale translations.

You normally never edit this file by hand — the UI does it for you.

---

## Commands

Run `glotfile <command>` (or `node bin/glotfile.js <command>` from a checkout).
All commands accept `--file <path>` (`-f`) to target a state file other than
`./glotfile.json`. Run `glotfile --help` for the command list, or
`glotfile <command> --help` for a command's options.

| Command | What it does |
|---|---|
| `glotfile` &nbsp;or&nbsp; `glotfile serve` | Start the local web UI and open the browser. |
| `glotfile translate` | AI-translate strings (writes results back to `glotfile.json`). |
| `glotfile export` | Write the locale files for every configured output. |
| `glotfile prune --empty-source` | List keys whose source value is empty (dry run); add `--write` to remove them. |
| `glotfile prune --unused` | List keys with no code reference in the last scan (dry run); add `--write` to remove them. Runs a scan first. |

### `translate` options

```bash
glotfile translate                           # fill empty values (the default)
glotfile translate --all                     # re-translate every string
glotfile translate --locale fr,de            # only these target languages
glotfile translate --key "auth.*"            # only keys matching a glob
```

These combine. With no flags, only empty values are filled; `--all` re-translates
every string (a `reviewed` value is never overwritten either way).

### `export` options

```bash
glotfile export                      # write all configured outputs
glotfile export --adapter laravel-php   # just one format
```

Re-running `export` with no changes produces a zero-line diff — safe to run in
CI to check your locale files are up to date.

### `prune` options

```bash
glotfile prune --empty-source          # list keys with an empty source (dry run)
glotfile prune --empty-source --write  # remove them

glotfile prune --unused                # list keys with no code reference (dry run)
glotfile prune --unused --write        # remove them
```

`--unused` runs a scan first, so the result reflects your current code, and
treats keys referenced only by a dynamic prefix (e.g. `t('errors.' + code)`) as
used. The selectors combine: `prune --unused --empty-source --write` removes the
union of both sets.

Dry-run by default — it prints what it would remove and changes nothing until
`--write` is passed. Recovery is via git, like every other edit.

---

## The web UI

`glotfile serve` opens a single-page app for managing the catalog:

- **Editor** — a searchable, filterable table of every key with the source string and each target language side by side. Create, rename, and delete keys; edit values inline; toggle each value's review **state** (`source` → `machine` → `reviewed` / `needs-review`). Filter by missing, machine (unreviewed), tag, or free text.
- **Per-key metadata** — context for humans and the AI, tags, a max length, freeform notes, and a screenshot showing where the string appears.
- **Plurals** — manage CLDR plural forms (`one`, `other`, …) per language.
- **Languages** — add or remove the locales you maintain.
- **Glossary** — terms to never translate, and forced translations per language; these are injected into every AI request.
- **Screenshots** — attach an image to a key so vision-capable models can see the UI context.
- **Settings** — edit the `config` block (source locale, outputs, AI provider/model, formatting, custom spelling dictionary).
- **AI log** — a record of recent translation runs (prompts and results; never your API keys or image bytes).

The UI also surfaces **checks** (missing values, placeholder mismatches, length
and glossary violations) and an **export preview** before you write files.

---

## Output formats

Add entries to `config.outputs`; each names an adapter and a path template
(`{locale}` and `{namespace}` are substituted). Available adapters:

| Adapter | Target |
|---|---|
| `flutter-arb` | Flutter `.arb` files |
| `laravel-php` | Laravel `lang/**/*.php` arrays |
| `i18next-json` | i18next / generic JSON |
| `gettext-po` | gettext `.po` |
| `apple-stringsdict` | Apple `.stringsdict` |

Placeholders (`{name}`, `{{count}}`, `%s`, `:name`) and ICU plural/select
structure are preserved across formats; where a conversion would be lossy the
export warns rather than corrupting output.

---

## AI translation

Translation is the only feature that needs network access or credentials —
everything else works offline. Configure the provider in `config.ai` (via the
Settings panel or by editing the file), make sure the credentials are in your
environment, then translate from the **Editor** or with `glotfile translate`.

Glotfile reads credentials from the environment, including a local `.env` file
in the project directory. For example:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

Six providers are supported — Anthropic (default), OpenAI, AWS Bedrock
(Amazon Nova, Claude, and Meta Llama), OpenRouter, Claude Code, and Ollama
(local, no API key needed). For the full setup of
each — required env vars, model ids, regions, and the optional SDKs to install — see
**[AI Providers](https://glotfile.dev/docs/ai-translation/ai-providers/)**.

What the translator does for you:

- Sends each string with its key context, relevant glossary terms, the target locale, any max length, and (for vision-capable models) its screenshot.
- Preserves interpolation placeholders and ICU plural/select structure, and validates them on the way back — a translation that drops a placeholder or busts a length limit is rejected, not written.
- Writes results as **`machine`** state and **never overwrites a value you've marked `reviewed`**, so human edits are safe.
- Skips screenshots for models that can't see them (and tells you), so any model still works.

---

## Suggested workflow

1. Run `glotfile serve`, add keys and source copy as you build a feature.
2. `glotfile translate` (or the Editor's translate action) to fill the other languages.
3. Review machine translations in the UI; promote good ones to `reviewed`.
4. `glotfile export` to regenerate your apps' locale files.
5. Commit `glotfile.json` together with your code — the diff is the review.

Because the catalog is just a file in your repo, branching, pull-request review,
and rollback all work the way they already do for code.

## Large catalogs: split storage

A catalog grows with every key and locale. Past a few megabytes, a single
`glotfile.json` makes `git diff` slow, overflows GitHub's render limit, and
conflicts badly. Run:

```
glotfile split
```

This converts `glotfile.json` into a `glotfile/` directory:

```
glotfile/
  config.json        # { $schema, version, config, glossary } — everything except keys
  keys.json          # per-key metadata (tags, notes, context, plurals)
  locales/
    en.json          # one file per locale
    fr.json
    ...
```

Now translating a locale, or adding a key, changes only the relevant file(s).
New projects stay as a single `glotfile.json`; splitting is an explicit,
one-time, reviewable commit. The CLI, web UI, and exports behave identically
either way.
