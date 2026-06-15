# `glotfile split`

Converts a single `glotfile.json` into a `glotfile/` **directory** of smaller files — one per locale plus shared config and key metadata. For large catalogs this keeps `git diff` fast and reviewable: an AI run on French rewrites only `glotfile/locales/fr.json`.

```bash
glotfile split
```

This is a one-time, deliberate operation that produces a clearly-labelled commit and sets `config.storage` to `"split"`. After splitting, the CLI, web UI, and every export adapter behave identically — only the on-disk layout changes. Load auto-detects the format, so nothing else needs configuring.

See The State File for the full directory layout and the trade-offs.

## Related

- The State File · Configuration Reference
