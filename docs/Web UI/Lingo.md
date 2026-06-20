# Lingo — your translation assistant

Lingo is an AI assistant built into the glotfile web UI. It can read your project **and your codebase**, then help you set up everything that makes your app translate well — your project context, per-language rules, glossary, per-string context, and source strings — through a conversation. Lingo doesn't do the translating itself; it gets the setup right so the translations the app produces come out good.

## Requirements

> **⚠ Lingo needs an Anthropic provider**
> Lingo is powered by Anthropic models. The toggle only appears when your active AI provider (Settings → AI) is **Anthropic** and `ANTHROPIC_API_KEY` is set in the environment running the server. With any other provider, Lingo stays hidden. See AI Providers.

## Opening Lingo

- Click the **✨ Lingo** button at the top-right of the header, or press **⌘ J** (**Ctrl J** on Windows/Linux).
- The shortcut summons Lingo and focuses the message box; pressing it again while you're typing hides the panel. **Esc** also closes it.

## Docked or expanded

Lingo opens beside your work, and remembers the layout you last used:

- **Docked** — a resizable column next to the current view. Drag its left edge to resize; the width is remembered across sessions.
- **Expanded** — a wider drawer over most of the content for longer conversations. Click the dimmed area (or the minimise button) to collapse back to the docked column.

## What Lingo can do

- **Understand your project** — locales, keys, translation progress, and the guidance and glossary you already have.
- **Read your codebase** — search and read files (your README, components, locale files) to learn what your product actually is. This is **read-only** and scoped to your project directory.
- **Author guidance** — write your project context and per-language rules for you, so the AI translator has the background it needs. See How Translation Works.
- **Build your glossary** — add terms that must translate consistently or stay verbatim, and accept or dismiss suggested terms.
- **Sharpen each string** — write the per-key context that disambiguates a key, set tags and a length budget, fix or reword source text, and add or delete keys.

**What Lingo won't do:** Lingo never writes or reviews translations — single or bulk. When you want strings translated or a whole language reviewed, run it from the app's own translate/review controls; Lingo's job is to make that run come out better, not to do it for you.

## How Lingo works with you

> **Lingo proposes, you approve**
> Before any edit is written, Lingo lists what it's about to change and shows an **Approve** button — nothing touches your config until you click it (no need to type "yes"). When a task takes several edits, they're grouped behind a **single** Approve, so you green-light the whole job at once rather than one edit at a time. Click **Skip** to decline. Reading your project and codebase, and filtering or opening keys in the editor, happen freely — only edits ask for approval.

Every change Lingo makes is written straight to `glotfile.json` — so it shows up as an ordinary git diff you can review or revert — and is recorded in the AI Log alongside your translation runs.

## Conversation history & privacy

- Your conversation is stored **locally, per project**, under `./.glotfile/chats/` (git-ignored) and survives page reloads. **New chat** clears it.
- As with every AI feature, only what's needed crosses the network and no API keys are ever written to disk. See AI Log.

## Related

- AI Providers · How Translation Works · AI Log · Settings
