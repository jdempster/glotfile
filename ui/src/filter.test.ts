import { describe, it, expect } from "vitest";
import { filterKeys, type KeyFilter } from "./filter.js";
import { useSelection } from "./selection.js";
import type { Config, Issue, State } from "./types.js";

const baseConfig: Omit<Config, "sourceLocale" | "locales"> = {
  outputs: [],
  format: { indent: 2, sortKeys: true, finalNewline: true },
};

const state: State = {
  version: 1,
  config: { sourceLocale: "en", locales: ["en", "fr"], ...baseConfig },
  keys: {
    "a.key": { values: { en: { value: "Hi", state: "source" } } },
    "b.key": { values: { en: { value: "Bye", state: "source" }, fr: { value: "Au revoir", state: "reviewed" } } },
    "c.key": { values: { en: { value: "Yo", state: "source" }, fr: { value: "Salut", state: "machine" } } },
  },
};

const f = (over: Partial<KeyFilter> = {}): KeyFilter =>
  ({ text: "", states: [], issues: [], plurality: [], tag: "", needsAttention: false, emptySource: false, aiContextUnreviewed: false, noUsages: false, skipTranslate: false, ...over });

describe("filterKeys", () => {
  it("no facets → every key, sorted", () => {
    expect(filterKeys(state, f())).toEqual(["a.key", "b.key", "c.key"]);
  });
  it("needsAttention → only keys that have at least one issue", () => {
    const byKey = new Map<string, Issue[]>([
      ["a.key", [{ key: "a.key", locale: "fr", check: "untranslated", message: "x" }]],
      ["c.key", [{ key: "c.key", locale: "fr", check: "spelling", message: "y" }]],
    ]);
    expect(filterKeys(state, f({ needsAttention: true }), byKey)).toEqual(["a.key", "c.key"]);
  });
  it("needsAttention matches nothing when no issue index is supplied", () => {
    expect(filterKeys(state, f({ needsAttention: true }))).toEqual([]);
  });
  it("machine → only keys with a machine value", () => {
    expect(filterKeys(state, f({ states: ["machine"] }))).toEqual(["c.key"]);
  });
  it("reviewed → only keys with a reviewed value", () => {
    expect(filterKeys(state, f({ states: ["reviewed"] }))).toEqual(["b.key"]);
  });
  it("states OR within the group (machine OR reviewed)", () => {
    expect(filterKeys(state, f({ states: ["machine", "reviewed"] }))).toEqual(["b.key", "c.key"]);
  });
  it("free text matches key/value/context", () => {
    expect(filterKeys(state, f({ text: "revoir" }))).toEqual(["b.key"]);
  });
  it("issue facet filters by the issue index", () => {
    const byKey = new Map<string, Issue[]>([
      ["c.key", [{ key: "c.key", locale: "fr", check: "placeholder", message: "x" }]],
    ]);
    expect(filterKeys(state, f({ issues: ["placeholder"] }), byKey)).toEqual(["c.key"]);
  });
  it("issue facet matches nothing when no index is supplied", () => {
    expect(filterKeys(state, f({ issues: ["placeholder"] }))).toEqual([]);
  });
  it("AND across groups: machine state AND placeholder issue", () => {
    const byKey = new Map<string, Issue[]>([
      ["b.key", [{ key: "b.key", locale: "fr", check: "placeholder", message: "x" }]],
      ["c.key", [{ key: "c.key", locale: "fr", check: "spelling", message: "y" }]],
    ]);
    expect(filterKeys(state, f({ states: ["machine"], issues: ["placeholder"] }), byKey)).toEqual([]);
  });
  it("skipTranslate → only keys flagged skip-translate", () => {
    const s: State = {
      ...state,
      keys: { ...state.keys, "b.key": { ...state.keys["b.key"]!, skipTranslate: true } },
    };
    expect(filterKeys(s, f({ skipTranslate: true }))).toEqual(["b.key"]);
  });
});

function mkFilter(p: Partial<KeyFilter> = {}): KeyFilter {
  return { text: "", states: [], issues: [], plurality: [], tag: "", needsAttention: false, emptySource: false, aiContextUnreviewed: false, noUsages: false, skipTranslate: false, ...p };
}

function mkState(): State {
  return {
    version: 2,
    config: {
      sourceLocale: "en",
      locales: ["en", "fr", "de"],
      outputs: [],
      format: { indent: 2, sortKeys: true, finalNewline: true },
    },
    glossary: [],
    keys: {
      a: { values: { en: { value: "A", state: "source" }, fr: { value: "A-fr", state: "reviewed" } } },
      b: { values: { en: { value: "B", state: "source" }, fr: { value: "", state: "needs-review" } } },
      c: { values: { en: { value: "C", state: "source" }, de: { value: "C-de", state: "reviewed" } } },
    },
  } as unknown as State;
}

describe("filterKeys — locale-scoped facets", () => {
  it("missing facet scoped to a locale lists keys with no usable value there", () => {
    // fr: b has empty value, c has no fr record -> both missing in fr.
    const keys = filterKeys(mkState(), mkFilter({ locale: "fr", states: ["missing"] }));
    expect(keys).toEqual(["b", "c"]);
  });

  it("reviewed facet scoped to a locale matches only that locale's state", () => {
    const keys = filterKeys(mkState(), mkFilter({ locale: "fr", states: ["reviewed"] }));
    expect(keys).toEqual(["a"]);
  });

  it("unscoped state matching is unchanged (any locale)", () => {
    const keys = filterKeys(mkState(), mkFilter({ states: ["reviewed"] }));
    expect(keys).toEqual(["a", "c"]);
  });
});

// Source "en"; scalar.key has source text, plural.key is a plural with a populated
// source "other", blank.key has a whitespace-only source, and nosrc.key has no en record.
const pluralState: State = {
  version: 1,
  config: { sourceLocale: "en", locales: ["en", "fr"], ...baseConfig },
  keys: {
    "blank.key": { values: { en: { value: "  ", state: "source" } } },
    "nosrc.key": { values: { fr: { value: "Bonjour", state: "reviewed" } } },
    "plural.key": { plural: { arg: "count" }, values: { en: { forms: { other: "{count} items" }, state: "source" } } },
    "scalar.key": { values: { en: { value: "Hi", state: "source" } } },
  } as State["keys"],
};

describe("filterKeys — plurality facet", () => {
  it("plural-only → only plural keys", () => {
    expect(filterKeys(pluralState, f({ plurality: ["plural"] }))).toEqual(["plural.key"]);
  });
  it("single-only → only scalar keys", () => {
    expect(filterKeys(pluralState, f({ plurality: ["single"] }))).toEqual(["blank.key", "nosrc.key", "scalar.key"]);
  });
  it("both selected → no constraint (every key)", () => {
    expect(filterKeys(pluralState, f({ plurality: ["plural", "single"] }))).toEqual(["blank.key", "nosrc.key", "plural.key", "scalar.key"]);
  });
  it("empty plurality → no constraint", () => {
    expect(filterKeys(pluralState, f({ plurality: [] }))).toEqual(["blank.key", "nosrc.key", "plural.key", "scalar.key"]);
  });
});

describe("filterKeys — empty source facet", () => {
  it("matches blank scalar source and absent source record, excludes populated source", () => {
    // plural.key has a populated source `other`, so it is NOT empty-source.
    expect(filterKeys(pluralState, f({ emptySource: true }))).toEqual(["blank.key", "nosrc.key"]);
  });
  it("a plural key with a blank source `other` counts as empty source", () => {
    const s: State = {
      version: 1,
      config: { sourceLocale: "en", locales: ["en"], ...baseConfig },
      keys: { "p": { plural: { arg: "count" }, values: { en: { forms: { other: "" }, state: "source" } } } } as State["keys"],
    };
    expect(filterKeys(s, f({ emptySource: true }))).toEqual(["p"]);
  });
});

describe("filterKeys — exact-match (quoted) text", () => {
  it("quoted text matches only the exactly-named key", () => {
    expect(filterKeys(state, f({ text: '"a.key"' }))).toEqual(["a.key"]);
  });
  it("quoting requires a whole-key match, unlike the bare substring search", () => {
    // Bare "key" is a substring of all three key names; quoted, "key" matches none.
    expect(filterKeys(state, f({ text: "key" }))).toEqual(["a.key", "b.key", "c.key"]);
    expect(filterKeys(state, f({ text: '"key"' }))).toEqual([]);
  });
  it("exact match is case-insensitive", () => {
    expect(filterKeys(state, f({ text: '"A.KEY"' }))).toEqual(["a.key"]);
  });
  it("exact match is scoped to the key name, not values/context", () => {
    // "Au revoir" is b.key's value; quoted it isn't a key name, so nothing matches.
    expect(filterKeys(state, f({ text: '"Au revoir"' }))).toEqual([]);
  });
});

describe("filterKeys — regex (^) text", () => {
  it("a leading ^ anchors a prefix match against the key name", () => {
    expect(filterKeys(state, f({ text: "^b" }))).toEqual(["b.key"]);
    expect(filterKeys(state, f({ text: "^b\\.key" }))).toEqual(["b.key"]);
  });
  it("supports full regex syntax (alternation, char classes)", () => {
    expect(filterKeys(state, f({ text: "^[ab]\\.key" }))).toEqual(["a.key", "b.key"]);
    expect(filterKeys(state, f({ text: "^(a|c)\\." }))).toEqual(["a.key", "c.key"]);
  });
  it("is case-insensitive, like the substring search", () => {
    expect(filterKeys(state, f({ text: "^A\\.KEY" }))).toEqual(["a.key"]);
  });
  it("regex is scoped to the key name, not values/context", () => {
    // "Au revoir" is b.key's fr value; a ^-anchored query never sees values.
    expect(filterKeys(state, f({ text: "^Au" }))).toEqual([]);
  });
  it("an invalid/half-typed pattern matches nothing instead of throwing", () => {
    expect(filterKeys(state, f({ text: "^a(" }))).toEqual([]);
  });
});

describe("regex filter feeds bulk selection", () => {
  // Bulk actions operate on the selection. "Select all" fills it from the
  // filtered rows (filterKeys output), and pruneTo — run on every filter change —
  // narrows an existing selection to the filtered set. So a ^-regex filter
  // governs exactly which keys a bulk change touches.
  it("select-all under a ^-regex selects exactly the matching keys", () => {
    const sel = useSelection();
    sel.selectAll(filterKeys(state, f({ text: "^[ab]\\.key" })));
    expect(sel.keys().sort()).toEqual(["a.key", "b.key"]);
  });

  it("tightening the filter to a ^-regex prunes the selection to the matches", () => {
    const sel = useSelection();
    sel.selectAll(filterKeys(state, f()));
    expect(sel.keys().sort()).toEqual(["a.key", "b.key", "c.key"]);
    // Filter changes → EditorView calls pruneTo(filteredKeys).
    sel.pruneTo(filterKeys(state, f({ text: "^a" })));
    expect(sel.keys()).toEqual(["a.key"]);
  });
});

describe("filterKeys — noUsages facet", () => {
  it("excludes keys present in the usedKeys set", () => {
    const used = new Set(["b.key"]);
    expect(filterKeys(state, f({ noUsages: true }), undefined, used)).toEqual(["a.key", "c.key"]);
  });
  it("composes with another facet (text search)", () => {
    const used = new Set(["a.key"]);
    expect(filterKeys(state, f({ noUsages: true, text: "key" }), undefined, used)).toEqual(["b.key", "c.key"]);
  });
  it("is a no-op when no usedKeys set is supplied", () => {
    expect(filterKeys(state, f({ noUsages: true }))).toEqual(["a.key", "b.key", "c.key"]);
  });
});
