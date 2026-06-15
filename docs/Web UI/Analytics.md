# Analytics

The Analytics panel answers one question — **can I ship?** — plus the detail behind the answer: how complete and how reviewed your catalog is per locale, and what's blocking a release.

## The release gate

The "Ready to ship" verdict is computed from the **same lint report as `glotfile check`**: the lint rules over your catalog plus the output-drift check. If the CLI fails, the panel shows the same blockers, and vice versa — the two can never disagree.

A locale is **Ready** when it clears the gate:

- 100% translated (no `empty-translation` errors)
- 0 lint errors (placeholder mismatches, glossary violations, …)
- Outputs exported (no stale files on disk)
- Nothing stale (no needs-review strings; these mark a locale **Almost** rather than blocked)

Reviewed state is optional — a fully machine-translated locale can ship.

### Skipping rules

The gate honors `config.lint.rules` in `glotfile.json`, exactly like the CLI. Set a rule to `"off"` to skip it in both places, or change its severity:

```json
{
  "lint": {
    "rules": {
      "identical-to-source": "off",
      "spelling": "warn"
    }
  }
}
```

Rules at `error` severity block the release; `warn` rules surface as warnings only. See *Checks and Validation* for the full rule list.

## Totals

At the top: total keys, number of locales, overall **translated %** and **reviewed %**, open issues, and the source word count.

## Per locale

For each target locale:

- Verdict against the release gate (**Ready / Almost / Blocked**) with its blockers
- **Translated %** and a breakdown of states: reviewed, needs-review, machine, missing
- Breaking and warning counts from the lint report

Click any locale, issue, or worklist item to drill into the matching strings in the Editor.

> **Tip:** Reviewed ≠ translated — a locale can be 100% *translated* (no missing values) but only 40% *reviewed*. The two percentages together tell you whether you have copy at all, and whether a human has signed off on it.

## Related

- Review States · Editor · Checks and Validation · Lint and Check (CLI)
