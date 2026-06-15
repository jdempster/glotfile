# Settings

The Settings panel edits the `config` block of `glotfile.json`. Every field here is also documented in the Configuration Reference.

## What you can configure

- **Source locale** — the language you author in.
- **Locales** — the languages you maintain (add / remove). See Keys and Locales.
- **Outputs** — the export targets: adapter + path template per entry. See Output Formats.
- **AI** — provider, model, endpoint, region, and batch size. See AI Providers.
- **Formatting** — indent, sort keys, final newline (controls how `glotfile.json` is written).
- **Custom dictionary** — words the spelling check should accept.

## Save behaviour

Most edits across the UI save immediately to `glotfile.json`. In Settings, some changes are explicit:

> **⚠ Dictionary changes require an explicit save** — edits to the custom spelling dictionary are staged and only written when you **Save**, so you can add several words without a write (and a git diff) per keystroke.

## Related

- Configuration Reference · Output Formats · AI Providers · Checks and Validation
