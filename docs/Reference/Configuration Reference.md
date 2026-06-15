# Configuration Reference

Every field in the `config` block of `glotfile.json` — the configuration you **commit** alongside your code. Edit these in Settings rather than by hand where you can.

> **Info:** AI provider settings are **not** part of this committed config. They're per-machine and live in `.glotfile/settings.json` (gitignored) — see AI Providers.

```json
"config": {
  "sourceLocale": "en",
  "locales": ["en", "fr", "de"],
  "outputs": [
    { "adapter": "flutter-arb", "path": "lib/l10n/app_{locale}.arb" }
  ],
  "format": { "indent": 2, "sortKeys": true, "finalNewline": true },
  "spelling": { "customWords": [] },
  "lint": { "rules": {}, "ignore": [], "spelling": { "locales": {} } }
}
```

## `sourceLocale` (string, required)

The language you author in. **Must** be one of `locales`. See Keys and Locales.

## `locales` (string[], required)

Every language you maintain, including the source. See Keys and Locales.

## `outputs` (array, required)

Export targets. Each entry:

| Field | Type | Meaning |
|---|---|---|
| `adapter` | string | One of the adapters. |
| `path` | string | Path template with `{locale}` / `{namespace}`. |
| `style` | string? | Adapter-specific layout option (e.g. `"flat"`). |
| `localeCase` | `"lower-hyphen"` \| `"lower-underscore"` \| `"bcp47-hyphen"` \| `"bcp47-underscore"` \| null | Locale-code rendering style for this output. Default: the adapter's own convention (`bcp47-underscore` for ARB; `bcp47-hyphen` for `angular-xliff`, `rails-yaml` and `apple-strings`; `lower-hyphen` for all others). Applies to the `{locale}` path token and any in-file locale token. |
| `localeMap` | `{ [canonicalCode]: exportToken }` \| null | Per-locale override that wins over `localeCase`. Keys are canonical (lowercase-hyphen) codes and must be locales in `config.locales`. E.g. `{ "zh-hant": "zh_HK" }`. |

> **Info:** AI provider settings — `provider`, `model`, `endpoint`, `region`, `batchSize` — are **not** in `config`. They're per-machine local settings; see AI Providers.

## `format` (object, required)

Controls how `glotfile.json` is written — keeps diffs small. See The State File.

| Field | Type | Default |
|---|---|---|
| `indent` | number | `2` |
| `sortKeys` | boolean | `true` |
| `finalNewline` | boolean | `true` |

## `spelling` (object, optional)

| Field | Type | Meaning |
|---|---|---|
| `customWords` | string[] | Words the spelling check always accepts. |

## `lint` (object, optional)

Tune the validation rules (Settings → Quality checks in the UI). The spelling rule accepts Glossary terms and `config.spelling.customWords` automatically.

| Field | Type | Meaning |
|---|---|---|
| `rules` | `{ [ruleId]: "error" \| "warn" \| "off" }` | Per-rule severity overrides. |
| `ignore` | string[] | Key globs to skip. |
| `spelling.locales` | `{ [locale]: dictId }` | Use a specific dictionary for a locale. |

## `scan` (object, optional)

Tunes the codebase scan that powers usage detection and unused-key pruning. See scan.

| Field | Type | Meaning |
|---|---|---|
| `include` | string[] | Globs of files to scan. |
| `exclude` | string[] | Globs to skip. |
| `accessors` | string[] | Extra Flutter accessor names the `gen_l10n` object is bound to (auto-detection covers most projects; this is the escape hatch). |
| `patterns` | string[] | Custom usage-scan regexes (capture group 1 = the key) applied to every file. |
| `keep` | string[] | Key globs always treated as used (e.g. `auth.throttle`, `validation.*`) — for keys consumed by code the scan can't see, such as framework internals or vendored packages. They never show as unused and survive `prune --unused`. |

## `autoExport` (boolean, optional)

When `true` (the default), `glotfile serve` re-exports the locale files to disk on every change. Set `false` to write only on an explicit `glotfile export`.

## `exportLocales` (string[], optional)

An allow-list narrowing which locales every export writes. Empty or absent means export all of `locales`. Persisted so the serve auto-export hook honours it too.

## `storage` (`"single"` | `"split"`, optional)

On-disk layout. Absent or `"single"` keeps the monolithic `glotfile.json`; `"split"` persists the catalog as a `glotfile/` directory of per-locale files. Set automatically by `glotfile split` — see The State File.

> **⚠ Validation on load** — Glotfile validates the whole file when it loads. A bad `sourceLocale`, an unknown rule id, a plural key missing its `other` form, or a malformed value fails with a specific message rather than corrupting data.

## Related

- The State File · Output Formats · AI Providers · Checks and Validation
