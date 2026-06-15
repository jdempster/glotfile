import type { CheckId, Issue } from "./types.js";
import type { StateFacet, PluralityFacet } from "./filter.js";

export const ALL_CHECKS: CheckId[] = ["untranslated", "placeholder", "spelling", "length", "glossary"];
export const DEFAULT_ENABLED: CheckId[] = ["untranslated", "placeholder", "length", "glossary"];

// Every state facet filterKeys() understands — drives the FilterMenu's Status list
// and the active-filter chips. Keep in lockstep with StateFacet so neither drifts.
export const ALL_STATES: StateFacet[] = ["missing", "machine", "needs-review", "reviewed"];

// Drives the FilterMenu's Type list and the active-filter chips.
export const ALL_PLURALITY: PluralityFacet[] = ["plural", "single"];

export const CHECK_LABELS: Record<CheckId, string> = {
  untranslated: "Untranslated",
  placeholder: "Placeholder mismatch",
  spelling: "Spelling",
  length: "Too long",
  glossary: "Glossary",
};

export const STATE_LABELS: Record<StateFacet, string> = {
  missing: "Missing",
  machine: "Machine",
  reviewed: "Reviewed",
  "needs-review": "Needs review",
};

export const PLURALITY_LABELS: Record<PluralityFacet, string> = {
  plural: "Plural",
  single: "Single",
};

export function indexIssuesByKey(issues: Issue[]): Map<string, Issue[]> {
  const m = new Map<string, Issue[]>();
  for (const issue of issues) {
    const arr = m.get(issue.key);
    if (arr) arr.push(issue);
    else m.set(issue.key, [issue]);
  }
  return m;
}
