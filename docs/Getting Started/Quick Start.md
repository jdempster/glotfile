# Quick Start

This walks you from an empty project to translated, exported strings. It assumes you've done Installation.

## 1. Start the UI

From your project root:

```bash
glotfile
```

Your browser opens the Editor. If there's no `glotfile.json` yet, Glotfile uses defaults and writes the file on your first edit.

## 2. Add your languages

Open Settings and set:

- **Source locale** — the language you author in (e.g. `en`).
- **Locales** — every language you want to maintain (e.g. `en`, `fr`, `de`).

See Keys and Locales for how locales work.

## 3. Add keys and source copy

In the Editor, add a key in dot notation and type its source string:

| Key | `en` (source) |
|---|---|
| `auth.signIn.button` | `Sign in` |
| `auth.signIn.title` | `Welcome back` |

The source value is saved with the state `source`.

## 4. AI-translate the rest

> **Info:** One-time setup — AI translation needs an API key in your environment. The default provider is Anthropic — set `ANTHROPIC_API_KEY` (a local `.env` file works). See AI Providers for OpenAI and AWS Bedrock.

Fill the empty languages — from the Editor's translate action, or the CLI:

```bash
glotfile translate
```

New translations are written as `machine` state. Glotfile never overwrites a value you've marked `reviewed`. See How Translation Works.

## 5. Review

Back in the Editor, filter to **machine** to see unreviewed translations. Promote the good ones to `reviewed`; flag the rest. See Review States.

## 6. Export to your app's formats

Configure where files go in Settings (or Output Formats), then:

```bash
glotfile export
```

This writes the locale files for every configured output (Flutter ARB, Laravel PHP, i18next JSON, and more — see Output Formats).

## 7. Commit

Commit `glotfile.json` together with your code. The diff *is* the review:

```bash
git add glotfile.json lib/l10n/
git commit -m "Add sign-in copy + translations"
```

Because the catalog is just a file in your repo, branching, pull-request review, and rollback work exactly the way they already do for code.

## Where to go next

- Translation Workflow — the same loop, in depth
- Continuous Integration — keep translations healthy in CI
- The State File — what's actually in `glotfile.json`
