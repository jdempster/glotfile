# Editing from the CLI

Change the catalog precisely, without hand-editing `glotfile.json`. There are single-value commands for one-off edits, plus `apply` for a batch.

> **Info:** The state file is the source of truth and is re-serialized deterministically (stable key order, fixed indent). Prefer these commands over editing the JSON by hand — especially on a large catalog. See The State File.

## `glotfile set`

Set one value. The value is the positional argument, `--value`, or piped on stdin (handy for multi-line text).

```bash
glotfile set checkout.title "Review your order"      # the source string
glotfile set checkout.title "Kasse" --locale de      # one target translation
```

| Option | Description |
|---|---|
| `<key> [value]` | The key, then the value (or use `--value`, or pipe it on stdin). |
| `--locale <code>` | Set this target locale instead of the source. |
| `--value <v>` | The value, as a flag. |
| `--state <state>` | Resulting state for a target write: `reviewed` (default), `machine`, or `needs-review`. |
| `--create` | Create the key (scalar) if it doesn't exist yet (source writes only). |
| `--file`, `-f <path>` | Target a different state file. |

**Editing the source marks the rest stale.** With no `--locale`, `set` writes the **source** string and flips every `reviewed`/`machine` translation of that key to `needs-review` — it tells you how many:

```
set checkout.title (en) — 7 translation(s) now need re-translation (run `glotfile translate --state needs-review`)
```

Re-fill exactly those with `glotfile translate --state needs-review`. A target write (`--locale`) lands `reviewed` by default — a deliberate, authoritative edit, the same as typing it in the Editor; pass `--state machine` if it shouldn't count as reviewed. Plural keys are edited through `apply` (below), not `set`.

## `glotfile set-state`

Flip the review state of one key — or many via a glob — across locales.

```bash
glotfile set-state "auth.*" reviewed --locale fr   # approve all of auth.*'s French
```

| Option | Description |
|---|---|
| `<key\|glob> <state>` | A key or glob, then `machine` / `needs-review` / `reviewed`. |
| `--key <glob>` | Glob selecting keys (instead of the positional key). |
| `--locale <list>` | Locales to affect. Default: every target locale. |
| `--file`, `-f <path>` | Target a different state file. |

Only cells that already have a value are touched.

## `glotfile clear`

Empty target value(s) so they read as **untranslated** — a plain `glotfile translate` will then refill them.

```bash
glotfile clear "promo.*" --locale fr,de
```

| Option | Description |
|---|---|
| `<key\|glob>` | The key or glob to clear. |
| `--key <glob>` | Glob selecting keys (instead of the positional key). |
| `--locale <list>` | **Required** — the locale(s) to empty. Cannot be the source (edit that with `set`). |
| `--file`, `-f <path>` | Target a different state file. |

## `glotfile delete`

Delete whole keys — the source string **and every locale's translation of it**. Use `clear` if you only want to empty a translation.

```bash
glotfile delete checkout.old-title          # one key, deleted straight away
glotfile delete "promo.summer.*"            # a glob: lists its matches, deletes nothing
glotfile delete "promo.summer.*" --write    # …and now removes them
```

| Option | Description |
|---|---|
| `<key\|glob>` | The key or glob to delete. |
| `--key <glob>` | Glob selecting keys (instead of the positional key). |
| `--write` | Required for a glob — actually remove the matched keys. |
| `--file`, `-f <path>` | Target a different state file. |

There is no undo beyond git, so a glob is a dry run until `--write`; an exact key deletes immediately and exits `1` if it isn't in the catalog. Deleting a key doesn't touch the code that references it — check its usage first (`glotfile scan`, or the Usage tree in the UI), and run `glotfile export` afterwards to drop it from the locale files. To sweep keys that are already dead, `glotfile prune --unused` is the better tool.

## `glotfile apply`

Apply a JSON **array of write operations** read from stdin, all in one load → save. This is the tool for bulk edits on a large catalog: one file rewrite instead of one per edit, applied atomically.

```bash
cat ops.json | glotfile apply
glotfile apply --dry-run < ops.json
```

Each op is one object. Supported operations:

| `op` | Fields | Effect |
|---|---|---|
| `create` | `key`, `value` | New scalar key with a source value. |
| `set-source` | `key`, `value` | Set the source (flips targets to `needs-review`). |
| `set-target` | `key`, `locale`, `value`, `state?` | Set a target value (default state `reviewed`). |
| `set-source-forms` | `key`, `forms` | Set a plural key's source forms. |
| `set-forms` | `key`, `locale`, `forms`, `state?` | Set a plural target's forms. |
| `set-state` | `key`, `locale`, `state` | Flip one cell's state. |
| `clear` | `key`, `locale` | Empty a target value. |
| `delete` | `key` | Delete the whole key — source and every translation. |

```json
[
  { "op": "set-source", "key": "auth.title", "value": "Sign in" },
  { "op": "set-target", "key": "auth.title", "locale": "fr", "value": "Connexion", "state": "reviewed" },
  { "op": "create",     "key": "home.cta",   "value": "Get started" }
]
```

| Option | Description |
|---|---|
| `--dry-run` | Report what would change without writing. |
| `--continue-on-error` | Apply the ops that succeed and save anyway (default: any failure writes nothing). |
| `--file`, `-f <path>` | Target a different state file. |

It prints a summary:

```json
{ "applied": 3, "keysTouched": ["auth.title", "home.cta"], "saved": true, "dryRun": false, "errors": [] }
```

**Atomic by default:** if any op fails, nothing is written and the command exits non-zero with the failing op listed in `errors`. `--continue-on-error` instead applies the survivors and saves.

## Related

- Reading and Extraction · Review States · How Translation Works
