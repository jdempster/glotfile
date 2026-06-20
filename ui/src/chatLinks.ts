import { drillTo, drillToKey } from "./drilldown";
import { knownKeys, knownLocales } from "./keyIndex";
import type { StateFacet } from "./filter";

// What a backtick token in a Lingo message can link to in the editor: a key to
// open, a review state to filter by, or a target locale to focus. This generalises
// the original key-only linking so that, like keys, the things Lingo talks about
// (`needs-review`, `de`, …) become one-click filters.
export type ChatLink =
  | { kind: "key"; key: string }
  | { kind: "state"; state: StateFacet }
  | { kind: "locale"; locale: string };

// Review-state tokens (and their plain-English synonyms) → the editor's state
// facet. "source" is deliberately absent: it's the source-locale state, not a
// target-state the list filters on.
const STATE_TOKENS: Record<string, StateFacet> = {
  missing: "missing",
  untranslated: "missing",
  machine: "machine",
  reviewed: "reviewed",
  "needs-review": "needs-review",
  "needs review": "needs-review",
};

// Classify a backtick token into the editor action it links to, or null if it's
// inert code (a source string, an unknown word). Precedence: a real key wins over
// a state/locale keyword of the same spelling, since keys are the most specific.
export function classifyToken(token: string): ChatLink | null {
  const t = token.trim();
  if (!t) return null;
  if (knownKeys.value.has(t)) return { kind: "key", key: t };
  const lower = t.toLowerCase();
  const state = STATE_TOKENS[lower];
  if (state) return { kind: "state", state };
  if (knownLocales.value.has(lower)) return { kind: "locale", locale: lower };
  return null;
}

// Perform the editor navigation a classified link points to. Keys filter the list
// to the key and open it; states and locales drive the same drilldown the
// filter_view tool uses, so the list resets to exactly that filter.
export function applyChatLink(link: ChatLink): void {
  switch (link.kind) {
    case "key": drillToKey(link.key); break;
    case "state": drillTo({ states: [link.state] }); break;
    case "locale": drillTo({ locale: link.locale }); break;
  }
}
