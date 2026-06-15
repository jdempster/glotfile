# Review States

Every locale value carries a **state** that tracks where the translation is in its lifecycle. State is per *value*, not per key — `fr` can be `reviewed` while `de` is still `machine`.

| State | Meaning |
|---|---|
| `source` | The value in your source locale. It's what everything else is translated *from*. |
| `machine` | Produced by AI translation and **not yet reviewed by a human**. |
| `reviewed` | A human has checked and approved it. **AI translation never overwrites a `reviewed` value.** |
| `needs-review` | Flagged for attention — typically because the source string changed after this translation was made (see Keeping Translations Fresh). |

## The typical flow

```
source ──translate──▶ machine ──approve──▶ reviewed
                         ▲                     │
                         └── source changed ───┘
                              (needs-review)
```

1. You author a string in the source locale → `source`.
2. AI fills the other languages → `machine`.
3. You review in the Editor and promote good ones → `reviewed`.
4. If the source later changes, dependent translations are marked `needs-review` so they don't silently drift. See Keeping Translations Fresh.

## Why `reviewed` is protected

Marking a value `reviewed` is a promise: a human owns this translation. Glotfile honours that promise — neither `glotfile translate` nor the UI's translate action will overwrite it. To re-translate a reviewed value, change it back first.

## Filtering by state

In the Editor, filter by **missing**, **machine** (unreviewed), **needs-review**, or **reviewed**, plus a **needs-attention** facet for any key with an open issue. Analytics reports translated vs reviewed percentages per locale.

## Related

- How Translation Works · Keeping Translations Fresh
