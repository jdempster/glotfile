# Lingo — your translation assistant

Lingo is an AI assistant built into the glotfile web UI. It can read your project **and your codebase**, then help you set up and maintain your translations through a conversation — starting with your project context and per-language guidance, with more on the way.

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
- **Author guidance** — write your project context note and per-language rules for you, so the AI translator has the background it needs. See How Translation Works.

More tools — managing glossary terms, filling in per-key context, and running translations from the chat — are on the way.

## How Lingo works with you

> **Lingo proposes, then waits**
> Lingo shows you the change it intends to make and waits for you to approve or adjust it before writing anything — it won't silently rewrite your config. Larger or bulk actions ask for an explicit confirmation first.

Every change Lingo makes is written straight to `glotfile.json` — so it shows up as an ordinary git diff you can review or revert — and is recorded in the AI Log alongside your translation runs.

## Conversation history & privacy

- Your conversation is stored **locally, per project**, under `./.glotfile/chats/` (git-ignored) and survives page reloads. **New chat** clears it.
- As with every AI feature, only what's needed crosses the network and no API keys are ever written to disk. See AI Log.

## Related

- AI Providers · How Translation Works · AI Log · Settings
