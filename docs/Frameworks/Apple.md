# Apple (iOS & macOS)

Apple localization splits across two files per locale, so glotfile uses two adapters that both write into `{locale}.lproj/`:

- **`apple-strings`** → `Localizable.strings` — the scalar strings.
- **`apple-stringsdict`** → `Localizable.stringsdict` — the plurals.

## Configure the outputs

Add **both** outputs in `glotfile.json`:

```json
{ "adapter": "apple-strings",     "path": "{locale}.lproj/Localizable.strings" },
{ "adapter": "apple-stringsdict", "path": "{locale}.lproj/Localizable.stringsdict" }
```

The Settings → Output Formats dropdown lists `apple-strings`; add the `apple-stringsdict` entry by editing `glotfile.json`. `apple-strings` skips plural keys (they would be lossy in a flat `.strings` table) and `apple-stringsdict` emits them as `NSStringLocalizedFormatKey` plist entries — so **without the second output your plurals never ship**.

## Import existing strings

```bash
glotfile import
```

Detection finds `*.lproj` directories that contain a `Localizable.strings` (that table only — `InfoPlist.strings` and other tables are ignored).

## Wire Xcode to the exports

Xcode picks up `.lproj` resources automatically once they're in the bundle. Use `NSLocalizedString("greeting", comment: "")`, `String(localized: "greeting")`, or SwiftUI `Text("greeting")`.

## Format notes

- **Placeholders** — printf style (`%@`, `%d`).
- **Literals** — mark literal text with ICU apostrophe quoting (`'{site}'`); it exports as plain `{site}`, and a literal `%` is escaped to `%%` so printf won't misread it. Fully escapable. See Placeholders and ICU.
- **Plurals** — live only in `.stringsdict`, keyed by CLDR categories (`one`, `other`, …) with an `NSStringPluralRuleType` spec.
- **Locale codes** — default to BCP-47 hyphen (`en.lproj`, `pt-BR.lproj`). See Output Formats.

## Related

- Output Formats · Placeholders and ICU · Plurals · Quick Start · Translation Workflow
