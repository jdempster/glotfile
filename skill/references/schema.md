# glotfile.json schema

Read this before editing the state file by hand. Glotfile re-serializes the file
deterministically (stable key order, fixed indent, trailing newline) so diffs stay
minimal — match that style, or just let a `glotfile` command / the UI write it.

Locales are canonicalized to lowercase BCP-47 (e.g. `pt-br`) on load and save.

## Top-level shape

```jsonc
{
  "version": 1,
  "config": { /* Config — see below */ },
  "glossary": [ /* term entries */ ],
  "keys": { /* keyName -> KeyEntry */ }
}
```

In **split** layout this is spread across `glotfile/config.json` (holds `version` +
`config` + `glossary`), `glotfile/keys.json` (metadata per key), and
`glotfile/locales/<code>.json` (the values for one locale).

## Config

```jsonc
{
  "sourceLocale": "en",
  "locales": ["en", "fr", "de"],          // every locale in the catalog
  "outputs": [                             // one per generated locale file set
    { "adapter": "flutter-arb", "path": "lib/l10n/app_{locale}.arb" }
    // OutputConfig also supports: style, emptyAs ("source"|"empty"|"omit"),
    // indent, finalNewline, includeLocale, localeCase, localeMap, localeAliases
  ],
  "format": { "indent": 2, "sortKeys": true, "finalNewline": true },
  "autoExport": true,                      // serve re-exports on change (default)
  "spelling": { "customWords": [] },
  "lint": { "rules": {}, "ignore": [], "spelling": {} },
  "scan": {                                // tunes `scan` / `prune --unused`
    "include": [], "exclude": [],          // globs limiting which files are scanned
    "accessors": [],                       // extra Flutter accessor names
    "patterns": [],                        // custom usage regexes (capture group 1 = key)
    "keep": ["analytics.*"]                // key globs ALWAYS treated as used (never pruned)
  }
}
```

`{locale}` in an output `path` is replaced with each locale's export token.
**Saving Settings from the UI replaces the whole `config` object** — any new `config.*`
section must be modeled in the round-trip or it is silently wiped.

### `config.scan` — keeping the scanner honest

`scan` (and therefore `prune --unused` and the UI usage tree) infers which keys the code
references. Tune it when the heuristic misses:

- `include` / `exclude` — globs narrowing which files are scanned.
- `accessors` — extra accessor names for Flutter's gen_l10n object (auto-detection covers
  most projects; this is the escape hatch).
- `patterns` — custom regexes for project-specific i18n call sites (capture group 1 is the key).
- **`keep`** — key globs **always counted as used**, so `prune --unused` never flags them.
  Use it for keys consumed by code the scanner can't see: framework internals, vendored
  packages, server-driven UIs, or keys built from a fully dynamic name. This is the fix when
  `prune --unused` lists a key you know is live — add the glob to `keep`, don't delete it.

## KeyEntry

```jsonc
{
  "context": "Shown on the empty-cart screen",  // helps the AI translate; optional
  "description": "…",
  "notes": [{ "id": "…", "text": "…", "at": "ISO-8601" }],
  "tags": ["checkout"],
  "maxLength": 40,                               // lint flags overflow
  "screenshot": "…",                             // path; used by vision providers
  "skipTranslate": false,                        // true => translate skips it; not "missing"
  "plural": { "arg": "count" },                  // presence => plural message
  "placeholders": {                              // typed placeholder metadata
    "count": { "type": "int", "format": "compact", "example": "1,000" }
  },
  "suppressions": [ /* dismissed lint findings; expire when source changes */ ],
  "values": {
    "en": { "value": "Your cart is empty", "state": "source" },
    "fr": { "value": "Votre panier est vide", "state": "machine" }
  }
}
```

### LocaleValue

A scalar key carries `value`; a **plural** key (one with a `plural` marker) carries
`forms` instead — one entry per ICU selector:

```jsonc
"values": {
  "en": {
    "forms": { "one": "{count} item", "other": "{count} items" },
    "state": "source"
  }
}
```

`state` is one of:

- `source` — the source-locale value (the authoritative text).
- `machine` — AI-translated, not yet reviewed.
- `needs-review` — flagged for human review (e.g. source changed after translation).
- `reviewed` — human-approved.

Plural form selectors are CLDR categories (`zero`, `one`, `two`, `few`, `many`, `other`)
or exact matches like `=0`/`=1`. Not every locale uses every category; the source
locale's set defines the message's branches.

## Glossary

`glossary` is an array of term entries that constrain how specific words/phrases are
translated (or kept verbatim). The lint `glossary` rule flags violations. See
`references/workflows.md` for how to add entries.
