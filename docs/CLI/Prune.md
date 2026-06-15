# `glotfile prune`

Removes keys you no longer need. It's a **dry-run by default** — it lists what it would remove and changes nothing until you pass `--write`.

```bash
glotfile prune --unused           # list keys with no code reference
glotfile prune --unused --write   # actually remove them
```

## Options

| Option | Description |
|---|---|
| `--empty-source` | Select keys whose source value is empty. |
| `--unused` | Select keys with no code reference (runs a scan first). |
| `--write` | Remove the selected keys. Without it, prune only lists them. |
| `--file`, `-f <path>` | Target a different state file. |

Pick exactly one of `--empty-source` or `--unused`. The `--unused` selector runs a fresh scan, so its accuracy depends on your `config.scan` settings — review the dry-run list before writing.

Keys matching a `config.scan.keep` glob are never selected by `--unused` — use it for keys consumed by code the scan can't see (framework internals, vendored packages). See Scan.

## Related

- scan · Keys and Locales · Configuration Reference
