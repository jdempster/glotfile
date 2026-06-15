# Placeholders and ICU

Translations must keep the machinery the source string carries: **interpolation placeholders** and **ICU plural/select** structure. Glotfile protects both during translation, validation, and export.

## One canonical form, converted on export

Glotfile stores every placeholder in a single **canonical** form — `{name}` —
no matter what style the source file used. Import normalises to it; export
converts it to each adapter's native style. So you edit and validate against one
syntax, and each output file still gets the flavour its framework expects.

| Format | Native style | Example | On import → stored | On export ← stored |
|---|---|---|---|---|
| Flutter ARB | ICU named | `{name}` | `{name}` (already canonical) | `{name}` |
| Vue I18n | single braces | `{name}` | `{name}` (already canonical) | `{name}` |
| Laravel | colon | `:name` | `{name}` | `:name` |
| Rails YAML | percent-brace | `%{name}` | `{name}` | `%{name}` |
| i18next | double braces | `{{name}}` | `{name}` | `{{name}}` |
| Angular XLIFF | placeholder element | `<x id="INTERPOLATION" equiv-text="{{name}}"/>` | `{name}` | `<x id="INTERPOLATION" equiv-text="{{name}}"/>` |

A translation that **drops, renames, or adds** a placeholder relative to the
source is:

- **rejected** by AI translation (not written), and
- flagged by the `placeholder-mismatch` rule.

Because everything is canonical internally, the editor and the checks only ever
look for `{name}` — they never mistake an unrelated colon or percent sign (a
time like `(h:m)`, a ratio `a:b`) for a placeholder.

> **printf formats** (`%s`, `%d` in gettext and Apple `.stringsdict`) are
> **export-only and lossy** — they sit outside the canonical guarantee. See
> *Lossy conversions* below.

## Literals — text that looks like a placeholder

To write text that *looks* like a placeholder but should be left alone, mark it
with **ICU apostrophe quoting**:

| You write | Means |
|---|---|
| `'{'` | a literal `{` |
| `'{name}'` | the literal text `{name}` (not a token) |
| `''` | a literal apostrophe `'` |

Quoted spans are treated as plain text everywhere: the editor doesn't highlight
them, the `placeholder-mismatch` check ignores them, and AI translation leaves
them untouched.

On **export**, each format renders a literal in its own native way so the
runtime won't interpolate it:

| Format | A literal `'{site}'` exports as | A literal `%` | Fully escapable? |
|---|---|---|---|
| Flutter ARB / Angular | `'{site}'` (ICU apostrophe — native) | — | ✅ |
| Vue I18n | `{'{site}'}` (vue literal interpolation) | — | ✅ |
| gettext / Apple | `{site}` (braces are plain text) | `%%` | ✅ |
| Rails YAML | `{site}` (braces are plain text) | best-effort | ✅ (braces) |
| **i18next** | `{site}` — but a literal `{{site}}` is emitted as-is | — | ⚠️ partial |
| **Laravel** | `{site}` — but a literal `:name` can't be protected | — | ⚠️ partial |

### Two formats can't fully escape

Neither **i18next** (`{{ }}`) nor **Laravel** (`:name`) has a way to mark its
own interpolation syntax as literal, so glotfile emits the best it can and
**warns** with `lossy-literal`:

- **i18next** — a literal whose content is a `{{name}}` token (you wrote
  `'{{site}}'`) is written verbatim and i18next *will* substitute it at runtime.
  A single-brace literal `'{site}'` → `{site}` is safe, since i18next only
  interpolates `{{ }}`.
- **Laravel** — a literal `:name` that matches a real placeholder in the *same*
  string collapses to the same `:name`, and Laravel interpolates both.

```
warning [lossy-literal] tpl @ en: i18next will interpolate a literal containing {{…}}; i18next has no escape for it
```

On **import**, the inverse runs wherever it's unambiguous: vue `{'…'}`, ICU
apostrophes, and a bare `{name}` in a Laravel/Rails file (whose interpolation is
`:name`/`%{name}`, so braces are literal) all become canonical literals.
i18next import stays **lenient** — a single-brace `{name}` is kept as a
placeholder — so an i18next literal round-trip is best-effort.

## ICU plural and select

ICU constructs like:

```
{count, plural, one {# item} other {# items}}
{gender, select, male {he} female {she} other {they}}
```

are preserved structurally. The `icu-mismatch` rule flags a string where one side (source or translation) is an ICU plural/select and the other isn't. See also Plurals for the dedicated plural-key model.

## Lossy conversions

Not every format can represent every construct. When export hits one it can't faithfully convert, it **warns and writes safe output** rather than emitting something broken:

```
warning [icu-unsupported] cart.items @ de: not representable in target format; wrote fallback
```

Treat these warnings as a prompt to simplify the string or pick a different adapter for that output.

## Related

- Plurals · Output Formats · Checks and Validation · How Translation Works
