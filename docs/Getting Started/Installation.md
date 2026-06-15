# Installation

## Requirements

- **Node.js** `^20.19.0 || >=22.12.0`

That's the only hard requirement. Everything except AI translation runs fully offline, with no account and no network access.

## Running Glotfile

Glotfile is designed to run with **no install** via `npx`:

```bash
npx glotfile
```

Or install it globally:

```bash
npm i -g glotfile
```

> **⚠ Pre-1.0** — Glotfile is published to npm but still pre-1.0, so expect occasional breaking changes; pin a version (e.g. `npx glotfile@0.8.7`) if you need stability.

Throughout these docs, `glotfile <command>` and `node bin/glotfile.js <command>` are interchangeable.

## First run

Run Glotfile from the root of the project whose copy you want to manage:

```bash
glotfile          # same as: glotfile serve
```

This starts a local server bound to `127.0.0.1`, opens your browser, and:

- If a `glotfile.json` already exists in the current directory, it loads it.
- If not, it starts from sensible defaults and **writes the file as soon as you make your first edit**.

> **Info:** Already have locale files? — Import an existing project by reading your current `.arb` / `.php` / `.json` files *into* the catalog with `glotfile import` — see import.

## Targeting a different file

Every command accepts `--file` (`-f`) to use a state file other than `./glotfile.json`:

```bash
glotfile serve --file packages/app/glotfile.json
```

## Developing Glotfile itself

If you're hacking on Glotfile (not just using it), run the Vite UI with hot-reload alongside the server:

```bash
npm run dev
```

## Next steps

- Quick Start — translate your first strings
- The State File — understand what `glotfile.json` holds
