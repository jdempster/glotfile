# Key Context and Metadata

Beyond its values, each key can carry metadata that improves translation quality and helps reviewers. Edit it in the Editor's per-key detail panel.

| Field | What it's for |
|---|---|
| **Context** | A note for humans *and the AI* explaining where/how the string is used. The single highest-leverage field for good machine translation. |
| **Notes** | Timestamped freeform notes — a running comment thread on the key. |
| **Tags** | Labels for grouping and filtering (e.g. `auth`, `cta`, `email`). Analytics reports coverage per tag. |
| **Max length** | A character budget. AI translations that exceed it are rejected, and the `max-length` check flags any value over the limit. |
| **Screenshot** | An image showing where the string appears. Sent to vision-capable models for context. See Screenshots. |
| **Skip translate** | Marks a key to be excluded from translation runs (e.g. a code-like token that should never change). |

## Why context matters most

Translators — human or AI — can't see your UI. A bare string like `"Open"` could be a verb (open a file) or an adjective (the store is open), and they translate differently. A one-line **context** removes the ambiguity:

> **Example:** Key `store.status.open` → context: *"Adjective. Shown on a badge when the shop is currently accepting orders."*

AI translation sends the context, the relevant Glossary terms, any max length, and the screenshot along with each string.

## A note on `description`

The state file also reserves a `description` field on keys. It is not yet editable in the UI — prefer **context** (which feeds the AI) and **notes** (for human discussion) today.

## Related

- Glossary · Screenshots · How Translation Works · Checks and Validation
