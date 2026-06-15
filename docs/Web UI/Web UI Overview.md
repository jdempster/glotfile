# Web UI Overview

`glotfile serve` (or just `glotfile`) opens a single-page app for managing your catalog. It runs locally, bound to `127.0.0.1`, and writes changes straight back to `glotfile.json`.

## The panels

A nav rail switches between six panels:

| Panel | What it's for |
|---|---|
| Editor | The heart of the app — a searchable, filterable table of every key with the source and each translation side by side. |
| Analytics | Coverage and review progress per locale, namespace, and tag. |
| Screenshots | Attach and review images that give the AI visual context. |
| **Glossary** | Manage do-not-translate and forced terms — see Glossary. |
| Settings | Edit the `config` block: locales, outputs, AI provider, formatting, dictionary. |
| AI Log | A record of recent translation runs (egress only). |

## Cross-cutting features

- **Checks** — the UI continuously surfaces issues (missing values, placeholder mismatches, length and glossary violations) so you can fix them as you go.
- **Export preview** — before writing files, preview exactly what `glotfile export` will produce. See Output Formats.
- **Save semantics** — most edits save immediately to `glotfile.json`. A few settings (notably dictionary changes) require an explicit **Save** — see Settings.

## Privacy

Nothing leaves your machine except the AI calls you choose to make. The UI is local; the AI Log never stores your API keys or screenshot bytes.

## Related

- CLI Overview — the same operations without the browser
- Quick Start — a guided first run
