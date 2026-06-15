# Translation Workflow

The day-to-day loop, end to end. This is the same flow as Quick Start, but with the *why* behind each step.

## The loop

```
author ──▶ translate ──▶ review ──▶ export ──▶ commit
   ▲                                              │
   └──────────────── next feature ───────────────┘
```

### 1. Author source copy as you build

Run `glotfile serve` and add keys with their source strings in the Editor while you build a feature. Add a one-line context for anything ambiguous — it's the highest-leverage thing you can do for translation quality. Attach a screenshot for UI-heavy strings.

### 2. Fill the other languages

```bash
glotfile translate
```

This fills only the empty values; pass `--all` to re-translate everything. Or use the Editor's translate action. New translations land as `machine`. See How Translation Works.

### 3. Review

Filter the Editor to **machine** and check the new translations. Promote good ones to `reviewed` (which protects them from being overwritten); flag the rest as `needs-review`. Watch the Analytics panel for reviewed-vs-translated coverage.

### 4. Export

```bash
glotfile export
```

This regenerates your apps' locale files from the catalog. See Output Formats.

### 5. Commit

Commit `glotfile.json` together with your code and the regenerated locale files. The diff *is* the review:

```bash
git add glotfile.json lib/l10n/
git commit -m "Checkout copy + translations"
```

## Why git-native pays off

Because the catalog is just a file in your repo:

- **Branching** — translations live on the feature branch with the code that needs them.
- **Pull-request review** — reviewers see copy changes as a normal diff.
- **Rollback** — reverting a commit reverts the copy too.
- **No drift** — CI can fail the build if exports are stale or the catalog has problems.

## Related

- Continuous Integration · Keeping Translations Fresh · How Translation Works · Review States
