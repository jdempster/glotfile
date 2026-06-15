# Keeping Translations Fresh

A translation is only correct relative to the source string it was made from. When you edit a source string, its translations may no longer match — Glotfile tracks this so nothing drifts silently.

## How staleness is detected

Each translated value records the **source string it was translated from** (the `source` field on the value). When you change a source string, any translation whose recorded source no longer matches is flagged **`needs-review`**. See Review States.

> **Example:**
> `auth.signIn.button` source `"Sign in"` → `fr: "Se connecter"` (reviewed, source `"Sign in"`).
> You change the source to `"Log in"`. The French value is now marked `needs-review` — it was translated from text that no longer exists.

## Finding stale translations

- In the Editor, filter to **needs-review**.
- Analytics counts `needs-review` per locale.

## Fixing them

1. Review the flagged value against the new source.
2. Edit it directly and mark it `reviewed`, **or**
3. Re-translate: a bare `glotfile translate` only fills **empty** values, so it won't touch a `needs-review` value that still has text. To have the AI redo non-empty values, run `glotfile translate --all` (or clear the stale value first, then `glotfile translate`). Either way, a value still marked `reviewed` is protected — unmark it first to have the AI redo it.

## Why not auto-overwrite?

Glotfile flags rather than silently re-translating because a source edit might be cosmetic (a typo fix that doesn't change meaning) or substantive (a different action entirely). Only you know which — so it surfaces the change and lets you decide.

## Related

- Review States · How Translation Works · Translation Workflow
