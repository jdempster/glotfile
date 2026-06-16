# `glotfile build-context`

AI-generates a short **context** note for each key — what it's for, where it appears — by reading the code snippets around its usages. Better context produces better translations. Requires a prior `glotfile scan` so the usage index exists.

```bash
glotfile scan
glotfile build-context
```

By default it only fills keys that have **no** context yet. The flags combine to narrow the run.

## Options

| Option | Description |
|---|---|
| `--all` | (Re)build context for every key, not just those missing it. |
| `--key <glob>` | Only keys matching this glob (e.g. `"auth.*"`). |
| `--limit <n>` | Process at most `n` keys. |
| `--since <date>` | Only keys added or changed since this date. |
| `--estimate` | Print the batches, token counts and estimated cost without building. |
| `--batch` | Submit via the provider's batch API (50% cost, async; anthropic only). |
| `--file`, `-f <path>` | Target a different state file. |

```bash
glotfile build-context --estimate            # batches, tokens and cost — no API calls
glotfile build-context --key "auth.*"        # only the auth namespace
```

It uses the same AI provider as `translate` (configured per-machine — see AI Providers). `--estimate` prints the same token/cost preview `translate --estimate` does — the input count is dominated by the code snippets attached to each key, so it tracks the real run. If no usage index is found it stops and tells you to run `scan` first.

## Related

- scan · translate · Key Context and Metadata · AI Providers
