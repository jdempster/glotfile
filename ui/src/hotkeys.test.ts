import { describe, it, expect } from "vitest";
import { shortcuts, reduceChord } from "./hotkeys.js";
import { routes } from "./router.js";

describe("shortcuts registry", () => {
  it("binds every NavRail route to a g-chord", () => {
    // Every entry's second key is unique so no two views collide.
    const letters = shortcuts.map((s) => s.keys[1]);
    expect(new Set(letters).size).toBe(letters.length);
    // Every entry is armed by "g".
    expect(shortcuts.every((s) => s.keys[0] === "g")).toBe(true);
  });

  it("covers exactly the routes the app exposes", () => {
    expect(new Set(shortcuts.map((s) => s.route))).toEqual(new Set(routes));
  });
});

describe("reduceChord", () => {
  const idle = { pending: null } as const;

  it("arms on g without acting", () => {
    const { state, action } = reduceChord(idle, "g");
    expect(state).toEqual({ pending: "g" });
    expect(action).toBeNull();
  });

  it("opens help on ? from idle", () => {
    const { state, action } = reduceChord(idle, "?");
    expect(state).toEqual({ pending: null });
    expect(action).toEqual({ type: "toggleHelp" });
  });

  it("ignores an unmapped key from idle", () => {
    const { state, action } = reduceChord(idle, "x");
    expect(state).toEqual({ pending: null });
    expect(action).toBeNull();
  });

  it("resolves g e to navigate editor and disarms", () => {
    const armed = reduceChord(idle, "g").state;
    const { state, action } = reduceChord(armed, "e");
    expect(state).toEqual({ pending: null });
    expect(action).toEqual({ type: "navigate", route: "editor" });
  });

  it("resolves a second g to Glossary, not a re-arm", () => {
    const armed = reduceChord(idle, "g").state;
    const { state, action } = reduceChord(armed, "g");
    expect(state).toEqual({ pending: null });
    expect(action).toEqual({ type: "navigate", route: "glossary" });
  });

  it("resolves g a to navigate analytics", () => {
    const armed = reduceChord(idle, "g").state;
    expect(reduceChord(armed, "a").action).toEqual({ type: "navigate", route: "analytics" });
  });

  it("swallows and resets on an unmapped letter while armed", () => {
    const armed = reduceChord(idle, "g").state;
    const { state, action } = reduceChord(armed, "z");
    expect(state).toEqual({ pending: null });
    expect(action).toBeNull();
  });

  it("does not treat ? as help while armed (it is an unmapped pair)", () => {
    const armed = reduceChord(idle, "g").state;
    const { state, action } = reduceChord(armed, "?");
    expect(state).toEqual({ pending: null });
    expect(action).toBeNull();
  });
});
