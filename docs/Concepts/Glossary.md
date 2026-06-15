# Glossary

The **glossary** is a list of terms that get special handling during AI translation and validation. It's stored at the top level of `glotfile.json` and edited in the Glossary panel.

Use it for two things:

1. **Do-not-translate terms** — brand names, product names, code identifiers that must appear verbatim in every language.
2. **Forced translations** — a term that must always render a specific way in a given locale.

## Entry shape

```json
"glossary": [
  { "term": "Glotfile", "doNotTranslate": true, "caseSensitive": true },
  {
    "term": "dashboard",
    "translations": { "fr": "tableau de bord", "de": "Übersicht" },
    "notes": "Always use the product term, not a literal translation."
  }
]
```

| Field | Meaning |
|---|---|
| `term` | The source-language term to match. |
| `doNotTranslate` | Keep the term verbatim in every translation. |
| `caseSensitive` | Match the term case-sensitively. |
| `translations` | Forced output per locale (`{ locale: "translation" }`). |
| `notes` | Freeform guidance (also passed to the AI). |

## How it's used

- **During translation:** relevant glossary terms for each string are injected into every AI request, so the model knows what to keep verbatim and what to render a fixed way. See How Translation Works.
- **During validation:** the `glossary-violation` rule flags any translation that drops a do-not-translate term or doesn't use the forced translation. See Checks and Validation.

> **Tip:** Only relevant terms are sent — Glotfile matches glossary terms against each source string and includes just the ones that appear — the AI isn't handed your entire glossary for every key.

## Related

- How Translation Works · Checks and Validation · Key Context and Metadata
