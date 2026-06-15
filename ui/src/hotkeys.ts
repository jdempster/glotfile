import type { Route } from "@/router";

export interface Shortcut {
  route: Route;
  // ["g", "e"] — armed by the first key, resolved by the second.
  keys: readonly [string, string];
  label: string;
}

// Single source of truth: drives the chord reducer, the NavRail tooltip hints,
// and the ? cheat-sheet overlay so the three can never drift apart. Ordered to
// match the NavRail. Adding a route the type union doesn't know fails to compile.
export const shortcuts: readonly Shortcut[] = [
  { route: "editor", keys: ["g", "e"], label: "Editor" },
  { route: "analytics", keys: ["g", "a"], label: "Analytics" },
  { route: "glossary", keys: ["g", "g"], label: "Glossary" },
  { route: "screenshots", keys: ["g", "i"], label: "Screenshots" },
  { route: "settings", keys: ["g", "s"], label: "Settings" },
  { route: "activity", keys: ["g", "l"], label: "Activity" },
  { route: "docs", keys: ["g", "d"], label: "Docs" },
];

export type ChordState = { pending: "g" | null };

export type Action =
  | { type: "navigate"; route: Route }
  | { type: "toggleHelp" }
  | null;

// Pure: no DOM, no timers. The composable owns those and drives this reducer.
// `key` is already lowercased by the caller.
export function reduceChord(state: ChordState, key: string): { state: ChordState; action: Action } {
  if (state.pending === "g") {
    // A registry pair always wins — a second "g" resolves to Glossary, it does
    // not re-arm. Anything unmapped is swallowed and resets the chord.
    const match = shortcuts.find((s) => s.keys[1] === key);
    return { state: { pending: null }, action: match ? { type: "navigate", route: match.route } : null };
  }
  if (key === "g") return { state: { pending: "g" }, action: null };
  if (key === "?") return { state: { pending: null }, action: { type: "toggleHelp" } };
  return { state: { pending: null }, action: null };
}
