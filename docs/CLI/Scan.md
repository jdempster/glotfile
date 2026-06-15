# `glotfile scan`

Scans your codebase for places each translation key is used, and writes the result to `.glotfile/usage.json` (gitignored). This usage index powers the **unused-keys** pruning, the per-key context builder, and the usage tree in the web UI.

```bash
glotfile scan
```

```
Scanned 214 file(s), found 1,038 reference(s).
```

## What it scans

The scan walks the project and matches key references. Tune it with the `config.scan` block — `include`/`exclude` globs, extra Flutter accessor names, and custom capture-group regexes. See Configuration Reference.

## Dynamically-built keys

Keys don't have to sit inside a `t()`/`__()` call to be found. Two extra signals count as (lower-confidence) usage:

- **Dynamic prefixes** — `__('errors.' . $code)` marks every key under `errors.` as used.
- **String literals** — a key-shaped string anywhere in a scanned file matches the catalog even outside a call site: assigned in a ternary (`$key = $a ? 'sms/arrival.delivery' : 'sms/arrival.message'`), stored in an array, interpolated (`"emails/export.subjects.{$type}"` marks everything under `emails/export.subjects.`), or sprintf-built (`'messages.%s.title'` — `%s`/`%d` match one key segment). A literal also acts as a prefix at a segment boundary, covering `__($head . '.title')` where `$head` holds the literal.

These show in the key's usage panel as "Possible usage", distinct from direct call-site references.

## Keys used by code the scan can't see

Dependency directories (`vendor`, `node_modules`, …) are never scanned, so a key whose only call site lives in a package — or one consumed by the framework itself, like Laravel's `auth.throttle` or `validation.*` — would be reported as unused. List those keys (globs allowed) in `config.scan.keep` and they're always treated as used:

```json
"scan": { "keep": ["auth.throttle", "validation.*", "passwords.*", "pagination.*"] }
```

## Related

- prune · build-context · Key Context and Metadata · Configuration Reference
