# How Translation Works

AI translation is the only feature that needs network access or credentials — everything else in Glotfile works offline. You can trigger it from the Editor or with `glotfile translate`; both use the same engine.

## What gets sent

For each string that needs translating, Glotfile sends the provider:

- the **source string** (or plural forms),
- the key's **context**,
- the relevant **Glossary** terms (only those that appear in the string),
- the **target locale**,
- any **max length**, and
- for vision-capable models, the key's **screenshot**.

Strings are sent in batches (the `ai.batchSize` setting, default 25).

## Validation on the way back

A translation is only written if it passes validation:

- **Placeholders** must match the source — a translation that drops or renames `{name}`, `%s`, `:id`, etc. is **rejected**. See Placeholders and ICU.
- **ICU plural/select** structure must be preserved.
- **Max length**, if set, must not be exceeded.

Rejected translations are reported and skipped, not written:

```
skip checkout.total @ de: placeholder {amount} is missing
```

## What it writes

- Accepted translations are written as **`machine`** state.
- A **`reviewed`** value is **never overwritten** — your human edits are safe.
- The source string each translation was made from is recorded, so later source edits can flag the translation as stale.

## Vision and model fit

Screenshots are sent only to models that can see them. For models that can't (e.g. Bedrock Meta Llama text models), the run proceeds **text-only** and prints how many screenshots were skipped — so any model still works. See AI Providers for the support matrix.

## Privacy

> **⚠ What leaves your machine** — AI translation is the **only** path by which your source strings leave your boundary. No credentials are ever written to `glotfile.json` or the AI Log. To keep strings in-region, pin a Bedrock region or point an Anthropic/OpenAI endpoint at an in-region gateway — see AI Providers.

## Batch mode

Batch mode submits translation jobs through the **Anthropic Message Batches API** at **50% of normal token cost**. Results are asynchronous — typically ready well under an hour, with a 24-hour upper bound. Batch mode is only available when `ai.provider` is `anthropic`.

### CLI

```
glotfile translate --batch          # submit and exit immediately
glotfile translate --batch --wait   # submit, then stay attached and apply when done
glotfile batch                      # check status; auto-applies results if finished
glotfile batch apply                # apply finished results now
glotfile batch cancel               # cancel a pending batch
```

### Web UI

When the Anthropic provider is active, the Translate dialog shows a **Batch (50% cost)** button alongside the normal Translate button. After submission, a banner in the editor tracks progress; when the batch finishes, click **Apply results** to write the translations.

### Pending handle

The in-flight batch state is stored in `.glotfile/batch.json` — project-local and machine-specific. Only one pending batch per project is tracked at a time. The `.glotfile/` directory is self-ignoring (it writes its own `.gitignore` entry), so `batch.json` is never committed.

### Staleness and error recovery

When results arrive, Glotfile checks each entry against the current state:

- Translations for keys whose **source text changed** (or that were **deleted**) since submission are **skipped**.
- Entries that the API marks as **failed**, or whose content is **malformed**, are automatically re-run through the normal synchronous translate path during apply.

## Related

- AI Providers · Glossary · Placeholders and ICU · AI Log
