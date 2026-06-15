# Flutter (ARB)

Glotfile exports your catalog to Flutter's `.arb` files with the **`flutter-arb`** adapter — one `app_{locale}.arb` per locale, ready for Flutter's `gen_l10n` code generator.

## Configure the output

In Settings → Output Formats (or `glotfile.json`):

```json
{ "adapter": "flutter-arb", "path": "lib/l10n/app_{locale}.arb" }
```

`glotfile export` then writes `lib/l10n/app_en.arb`, `app_fr.arb`, … each with an `@@locale` header.

## Import existing strings

If you already have `.arb` files, pull them into the catalog once:

```bash
glotfile import
```

Detection finds `*.arb` under `lib/l10n/`, `l10n/`, or `lib/src/l10n/`, strips the `app_` prefix, and records the `localeCase` so a later export reproduces your filenames byte-for-byte.

## Wire Flutter to the exports

Flutter turns ARB into Dart at build time. Add an `l10n.yaml` at the project root:

```yaml
arb-dir: lib/l10n
template-arb-file: app_en.arb
output-localization-file: app_localizations.dart
```

Set `generate: true` under `flutter:` in `pubspec.yaml`, then `flutter gen-l10n` (a normal `flutter run` regenerates too). Use it as `AppLocalizations.of(context)!.greeting`.

## Format notes

- **Placeholders** — ICU `{name}` is preserved as-is. Glotfile writes the `@key` placeholder metadata that `gen_l10n` needs to compile typed arguments.
- **Literals** — mark literal text with ICU apostrophe quoting (`'{site}'`); it is preserved verbatim (apostrophe quoting is ICU's native escape) and excluded from the `@key` placeholder metadata. Fully escapable. See Placeholders and ICU.
- **Plurals** — emitted as native inline ICU: `{count, plural, one {1 item} other {# items}}`.
- **Locale codes** — default to BCP-47 underscore (`app_en.arb`, `app_zh_Hant.arb`), written into `@@locale`. Flutter rejects some script subtags; remap with `localeMap`, e.g. `"localeMap": { "zh-hant": "zh_HK" }`. See Output Formats.

## Related

- Output Formats · Placeholders and ICU · Plurals · Quick Start · Translation Workflow
