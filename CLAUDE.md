# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Glotfile is a local-first, git-native translation manager: all strings live in a `glotfile.json` state file committed to the user's repo, edited through a local web UI, AI-translated via pluggable providers, and exported to platform locale formats (Flutter ARB, Laravel PHP, i18next/vue-i18n JSON, gettext `.po`, Apple `.strings`/`.stringsdict`, Angular XLIFF, Rails YAML). Distributed as a single npm package (`npx glotfile`); published to npm but not yet rolled out to real users, so on-disk format migrations and back-compat shims are unnecessary.

## Commands

- `npm run dev` — runs the Vite UI and the API server side by side. Open the UI at **http://localhost:5173** (Vite proxies `/api` to the API server on 8787 — don't open 8787 directly).
- `npm run build` — builds UI (`dist/ui`, via Vite) and server (`dist/server`, via tsup).
- `node bin/glotfile.js <command>` — run the built CLI (`serve`, `export`, `translate`, `lint`, `check`, `import`, `sync`, `build-context`, `scan`, `prune`, `split`, `skill`, `batch`). `import` does a one-shot read of existing locale files; `sync` re-merges them while preserving glossary/context/reviewed translations (the Angular resync path).
- `npm test` — full vitest run. Always prefer a single file: `npx vitest run src/server/state.test.ts`, or filter further with `-t "test name"`.
- `npm run typecheck` — `tsc --noEmit`. There are ~70 pre-existing baseline errors that vitest doesn't catch; don't mistake them for a regression you introduced.

Vitest has two projects: `server` (node env, `src/server/**/*.test.ts`) and `ui` (happy-dom, `ui/src/**/*.test.ts`). Tests are co-located `*.test.ts` files next to the source they cover.

## Architecture

Two halves, one package:

- **`src/server/`** — Node (ESM, NodeNext-style imports: always use the `.js` extension when importing TS modules). Contains both the CLI (`cli.ts`) and the local HTTP server (`server.ts`, Hono) which serves the built UI and the JSON API (`api.ts`). Everything CLI-reachable is also API-reachable; both layers are thin wrappers over the same core modules.
- **`ui/`** — Vue 3 SPA (Tailwind 4, reka-ui, TanStack table/virtual), its own `vite.config.ts` (root `vite.config.ts` just re-exports it). `@` aliases to `ui/src`. Markdown docs in `docs/` are bundled into the UI by `ui/src/plugins/vite-plugin-docs.ts`; per-framework setup guides live in `docs/Frameworks/`.

### State file is the core abstraction

`glotfile.json` is the single source of truth. The pipeline around it:

- `schema.ts` — types (`State`, `KeyEntry`, `Config`…) and validation; `CURRENT_VERSION`.
- `state.ts` — load/save plus all mutation functions (`setSourceValue`, `renameKey`, plural conversion, glossary, notes…). Locales are canonicalized to lowercase BCP-47 on load and save.
- `format.ts` + `atomic-write.ts` — deterministic serialization (stable key order, fixed indent, trailing newline) and atomic writes, so git diffs stay minimal.
- `storage.ts` — two on-disk formats behind one `State`: single file (`glotfile.json`) or split directory (`glotfile/` with `config.json`, `keys.json`, one file per locale). `detectFormat` picks; split wins over single. Any code touching persistence must work for both.

### Subsystems (all under `src/server/`)

- `adapters/` — one module per export format, registered in `adapters/index.ts`; shared placeholder/locale-token logic in `shared.ts` and `options.ts`.
- `import/` — detect format → parse (`import/parsers/`) → flatten → assemble into state. Round-trip tests assert import(export(x)) fidelity.
- `ai/` — `provider.ts` defines the `TranslationProvider` interface and shared prompt building; one module per backend (anthropic, openai, bedrock, openrouter, ollama, claudecode), chosen by `ai/index.ts#makeProvider`. `run.ts` handles request selection, batching, locale-parallel execution, and applying results. `context.ts` builds per-key context from code snippets.
- `lint/` — rule registry, spell-checking (nspell, optional dep), output checking, text/json/sarif reporters.
- `scanner.ts` / `scan.ts` — scans the user's codebase for key usage; feeds "unused keys" pruning and the UI usage tree.
- `local-settings.ts` vs `ui-prefs.ts` — per-machine state (API keys/editor in local settings; theme etc. in `~/.glotfile/ui.json`) deliberately kept out of the committed project config.

### Gotchas

- Saving Settings from the UI replaces the whole `config` object: any new `config.*` section must be modeled in the Settings round-trip (or explicitly passed through) or it will be silently wiped on save.
- `nspell`, `dictionary-en`, `openai`, and the Bedrock SDK are *optional* dependencies — code paths using them must degrade gracefully when absent (see `spell-deps.d.ts`, tsup marks `nspell` external).
- A new top-level docs section needs both a `docs/<Section>/` directory *and* an entry in `SECTION_ORDER` in `vite-plugin-docs.ts` — sections missing from that list never render in the UI.
