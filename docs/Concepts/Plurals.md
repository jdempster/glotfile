# Plurals

Some strings change shape with a count — "1 file" vs "5 files". Glotfile models these as **plural keys** using the [CLDR plural categories](https://cldr.unicode.org/index/cldr-spec/plural-rules).

## How a plural key differs

A normal key stores one `value` per locale. A **plural key** instead stores **`forms`** — one entry per category — and is marked with a `plural` field naming the **count argument**:

```json
"cart.items": {
  "plural": { "arg": "count" },
  "values": {
    "en": {
      "state": "source",
      "forms": { "one": "{count} item", "other": "{count} items" }
    },
    "pl": {
      "state": "reviewed",
      "forms": {
        "one": "{count} przedmiot",
        "few": "{count} przedmioty",
        "many": "{count} przedmiotów",
        "other": "{count} przedmiotu"
      }
    }
  }
}
```

## Plural categories

The six CLDR categories are:

`zero` · `one` · `two` · `few` · `many` · `other`

> **⚠ `other` is always required** — every locale's plural value **must** include the `other` form — it's the fallback every language has. Which of the other categories apply depends on the language (English uses `one`/`other`; Polish uses `one`/`few`/`many`/`other`).

## Editing plurals

In the Editor, a plural key shows a dedicated form editor with one field per category that the target language actually uses. AI translation fills every required category at once and validates the result.

## Across export formats

Plural and ICU `select`/`plural` structure is preserved when exporting, and converted to each format's native plural mechanism where one exists. Where a target format can't represent a construct, `glotfile export` warns rather than producing broken output. See Output Formats and Placeholders and ICU.

## Related

- Placeholders and ICU · How Translation Works · Keys and Locales
