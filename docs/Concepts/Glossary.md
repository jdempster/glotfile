# Glossary

The **glossary** is a list of terms that get special handling during AI translation and validation. It's stored at the top level of `glotfile.json` and edited in the Glossary panel.

You don't have to be a translator to use it. Capture what *you* know about a term — that it's a brand name, or what it means — and the AI handles the rest:

1. **Don't-translate terms** — brand names, product names, code identifiers that must appear verbatim in every language.
2. **Meaning notes** — disambiguate a homonym so the AI picks the right sense (e.g. `feed` = give a plant fertilizer, not a social feed). This is the single biggest quality lever, and anyone can write it.
3. **Pinned translations** — a term that must always render a specific way in a locale. You rarely type these yourself: Lingo (the AI assistant) fills them for you.

## Entry shape

```json
"glossary": [
  { "term": "Sprout", "doNotTranslate": true },
  {
    "term": "feed",
    "aliases": ["feeding", "feeds", "fed"],
    "notes": "Give a plant fertilizer — not a social-media feed.",
    "translations": { "de": "düngen" }
  }
]
```

| Field | Meaning |
|---|---|
| `term` | The source-language term to match. Matching is whole-word and case-insensitive — `Pro` applies to `Pro plan` but never to `Process`. |
| `aliases` | Other source forms of the same term (inflections, plurals, casing) — e.g. `feed` → `feeding`, `feeds`, `fed`. They widen which strings the term governs without loosening matching. Usually AI-suggested. |
| `doNotTranslate` | Keep the term verbatim in every translation. |
| `translations` | Pinned output per locale (`{ locale: "translation" }`). Lingo populates these — you never have to type a foreign word. Mutually exclusive with `doNotTranslate`. |
| `notes` | Meaning / usage guidance, passed to the AI. |

> **Note:** Whether a translation *kept* a don't-translate term (or used a pinned translation) is always checked leniently — an inflected or compounded form still counts, so `Webhooks` honors `Webhook`, German `Accounteinstellungen` honors `Account`, and Japanese `APIキー` honors `API`. Legitimate translations are never flagged. A pinned translation is only enforced where the canonical term appears (not on an alias-only match), so inflected mentions aren't mis-flagged.

## How it's used

- **During translation:** relevant glossary terms for each string are injected into every AI request, so the model knows what to keep verbatim, what a word means, and what to render a fixed way. Plural keys are scanned across every form, so a term that appears in only one form still applies. See How Translation Works.
- **During validation:** the `glossary-violation` rule flags any translation that drops a don't-translate term or doesn't use the pinned translation. See Checks and Validation.

> **Tip:** Only relevant terms are sent — Glotfile matches each term (and its aliases) against each source string and includes just the ones that appear — the AI isn't handed your entire glossary for every key. Matching is computed once per string and reused across every target locale.

## AI term suggestions

> **Beta — off by default.** This feature is still being refined and is hidden unless you opt in. Start Glotfile with the `GLOTFILE_BETA_GLOSSARY_SUGGEST=1` environment variable set to reveal the **Suggest terms with AI** button, the `suggest-glossary` command, and the related API routes. Without it, the affordances are hidden and the routes return 404.

Instead of building the glossary by hand, you can let Glotfile scan your source strings and propose candidates. Hit **Suggest terms with AI** in the Glossary view, or run:

```
glotfile suggest-glossary
```

The AI looks across your source-locale strings and surfaces brand/product names, acronyms, domain jargon, and recurring terms that look like good glossary candidates — along with any alias forms (inflections, plurals) and a meaning note. It does not read your code files and does not generate translations for the terms.

**Terms already in your glossary are skipped** — as are any terms you've previously dismissed — so you can run the command again as your catalog grows and only new candidates appear.

### Reviewing suggestions

Suggestions sit in a review queue; nothing changes until you act. Each entry shows a rationale note, the number of keys the term appears in, any proposed alias forms, and whether it's do-not-translate. From there you can:

- **Accept** — opens the normal add-term dialog prefilled with the suggestion so you can tweak it (pin translations, edit aliases) before saving.
- **Dismiss** — marks the term as reviewed so it won't reappear in future runs.

### Scoping and cost estimation

By default the command scans all source strings. Use these flags to narrow the scope or preview cost before running:

| Flag | Effect |
|---|---|
| `--key <glob>` | Only scan keys matching this glob. |
| `--limit <n>` | Scan at most *n* source strings. |
| `--since <date>` | Only keys added since this date. |
| `--estimate` | Print batches, token counts, and an estimated cost without scanning. |

Suggestions use your configured AI provider and model (the same one used for translation).

### Batch mode (50% off)

If your provider supports it, you can submit the scan as an async **batch job** instead of running it live. Batch jobs are processed by the provider's Batch API at roughly half the cost of a live scan, and typically finish within an hour.

**Anthropic is the only provider with batch support today.** On any other provider, batch mode is unavailable — `glotfile suggest-glossary --batch` exits with an error (re-run without `--batch` for a live scan), and the UI simply hides the batch button.

**CLI:**

```
glotfile suggest-glossary --batch
```

This submits the job and returns immediately. When you want to check whether it's done and apply the results, run:

```
glotfile batch
```

That command lists pending batch jobs; when a glossary-suggestion job is finished it applies the suggestions to the review queue automatically.

**UI:** when your active provider supports batch, the suggest dialog shows a batch button alongside the normal Suggest button — labelled **"Batch ≈ $X (50% off)"** once a cost estimate has loaded, or just **"Batch (50% off)"** otherwise. While a batch job is in flight, a pending-batch banner appears at the top of the Glossary view; once the job finishes an **"Apply results"** button appears on the banner.

Batch mode does not change what's scanned (still the full catalog of source strings, subject to any `--key`, `--limit`, or `--since` filters) and does not skip the review step — suggestions land in the same queue and still require you to Accept or Dismiss each one.

## Related

- How Translation Works · Checks and Validation · Key Context and Metadata
