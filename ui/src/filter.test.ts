import { describe, it, expect } from "vitest";
import { filterKeys, exactKeyQuery, type KeyFilter } from "./filter.js";
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
  it("exactKeyQuery narrows to exactly one key, excluding descendants (regression: a quoted search matched nothing)", () => {
    const tree: State = {
      version: 1,
      config: { sourceLocale: "en", locales: ["en"], ...baseConfig },
      keys: {
        "home.title": { values: { en: { value: "Home", state: "source" } } },
        "home.title.sub": { values: { en: { value: "Sub", state: "source" } } },
      },
    };
    expect(filterKeys(tree, f({ text: exactKeyQuery("home.title") }))).toEqual(["home.title"]);
    // The old onCreated form was a literal substring INCLUDING the quotes, so it
    // matched nothing and the freshly-added key stayed hidden until a refresh.
    expect(filterKeys(tree, f({ text: `"home.title"` }))).toEqual([]);
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

  it("missing facet scoped to a locale subset unions across those locales", () => {
    // a missing in de; b missing in fr (+de); c missing in fr -> all three.
    const keys = filterKeys(mkState(), mkFilter({ locales: ["fr", "de"], states: ["missing"] }));
    expect(keys).toEqual(["a", "b", "c"]);
  });

  it("reviewed facet scoped to a subset matches any of those locales", () => {
    const keys = filterKeys(mkState(), mkFilter({ locales: ["fr", "de"], states: ["reviewed"] }));
    expect(keys).toEqual(["a", "c"]);
  });

  it("a locales subset takes precedence over a single locale", () => {
    const keys = filterKeys(mkState(), mkFilter({ locale: "fr", locales: ["de"], states: ["reviewed"] }));
    expect(keys).toEqual(["c"]);
  });

  it("issue facets are scoped to the selected subset", () => {
    const byKey = new Map([
      ["a", [{ key: "a", locale: "de", check: "placeholder" as const, message: "x" }]],
      ["b", [{ key: "b", locale: "fr", check: "placeholder" as const, message: "y" }]],
    ]);
    // Only de is in scope, so b's fr-only issue drops out.
    const keys = filterKeys(mkState(), mkFilter({ locales: ["de"], issues: ["placeholder"] }), byKey);
    expect(keys).toEqual(["a"]);
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

// Source "en"; context on two keys, a plural with translated `forms`, to exercise
// scoped key/value/context search and regex.
const scopeState: State = {
  version: 1,
  config: { sourceLocale: "en", locales: ["en", "fr"], ...baseConfig },
  keys: {
    "auth.signIn": { context: "Primary CTA on the login screen", values: { en: { value: "Sign in", state: "source" }, fr: { value: "Se connecter", state: "reviewed" } } },
    "cart.items": { plural: { arg: "count" }, values: { en: { forms: { other: "{count} items" }, state: "source" }, fr: { forms: { other: "{count} articles" }, state: "machine" } } },
    "nav.home": { context: "Top navigation", values: { en: { value: "Home", state: "source" } } },
  } as State["keys"],
};

describe("filterKeys — scoped text search", () => {
  it("no prefix searches everything (key, value, context)", () => {
    // "items" hits the cart.items key and its source form; nothing else.
    expect(filterKeys(scopeState, f({ text: "items" }))).toEqual(["cart.items"]);
    // "screen" only appears in auth.signIn's context.
    expect(filterKeys(scopeState, f({ text: "screen" }))).toEqual(["auth.signIn"]);
  });

  it("key: scopes to the key name only", () => {
    expect(filterKeys(scopeState, f({ text: "key:auth" }))).toEqual(["auth.signIn"]);
    // "home" is in nav.home's key AND its source value, but key: ignores the value.
    expect(filterKeys(scopeState, f({ text: "key:home" }))).toEqual(["nav.home"]);
    // "connecter" is only a value, never a key → key: finds nothing.
    expect(filterKeys(scopeState, f({ text: "key:connecter" }))).toEqual([]);
  });

  it("value: scopes to translation values, including plural forms", () => {
    expect(filterKeys(scopeState, f({ text: "value:connecter" }))).toEqual(["auth.signIn"]);
    // plural `forms` are searchable, not just scalar values.
    expect(filterKeys(scopeState, f({ text: "value:articles" }))).toEqual(["cart.items"]);
    // a key fragment is not a value → no match.
    expect(filterKeys(scopeState, f({ text: "value:auth" }))).toEqual([]);
  });

  it("context: scopes to the context note only", () => {
    expect(filterKeys(scopeState, f({ text: "context:navigation" }))).toEqual(["nav.home"]);
    expect(filterKeys(scopeState, f({ text: "context:login" }))).toEqual(["auth.signIn"]);
    // a value is not context.
    expect(filterKeys(scopeState, f({ text: "context:connecter" }))).toEqual([]);
  });

  it("scopes are case-insensitive", () => {
    expect(filterKeys(scopeState, f({ text: "KEY:AUTH" }))).toEqual(["auth.signIn"]);
    expect(filterKeys(scopeState, f({ text: "value:SIGN" }))).toEqual(["auth.signIn"]);
  });

  it("an unknown prefix is treated as a literal substring over everything", () => {
    // "foo:" is not a scope, so this is a plain substring search (matches nothing here).
    expect(filterKeys(scopeState, f({ text: "foo:bar" }))).toEqual([]);
  });

  it("an empty term after a scope imposes no text constraint", () => {
    expect(filterKeys(scopeState, f({ text: "value:" }))).toEqual(["auth.signIn", "cart.items", "nav.home"]);
  });
});

describe("filterKeys — regex search (/…/)", () => {
  it("/…/ matches as a regex over everything by default, anchorable to the key", () => {
    expect(filterKeys(scopeState, f({ text: "/^auth\\./" }))).toEqual(["auth.signIn"]);
    expect(filterKeys(scopeState, f({ text: "/(auth|nav)\\./" }))).toEqual(["auth.signIn", "nav.home"]);
  });
  it("regex composes with a scope prefix", () => {
    expect(filterKeys(scopeState, f({ text: "key:/^nav/" }))).toEqual(["nav.home"]);
    expect(filterKeys(scopeState, f({ text: "value:/se connecter/" }))).toEqual(["auth.signIn"]);
  });
  it("regex is case-insensitive", () => {
    expect(filterKeys(scopeState, f({ text: "key:/^AUTH/" }))).toEqual(["auth.signIn"]);
  });
  it("an invalid/half-typed pattern matches nothing instead of throwing", () => {
    expect(filterKeys(scopeState, f({ text: "/auth(/" }))).toEqual([]);
    expect(filterKeys(scopeState, f({ text: "key:/auth(/" }))).toEqual([]);
  });
});

describe("regex filter feeds bulk selection", () => {
  // Bulk actions operate on the selection. "Select all" fills it from the
  // filtered rows (filterKeys output), and pruneTo — run on every filter change —
  // narrows an existing selection to the filtered set. So a regex filter
  // governs exactly which keys a bulk change touches.
  it("select-all under a key regex selects exactly the matching keys", () => {
    const sel = useSelection();
    sel.selectAll(filterKeys(state, f({ text: "key:/^[ab]\\.key/" })));
    expect(sel.keys().sort()).toEqual(["a.key", "b.key"]);
  });

  it("tightening the filter to a regex prunes the selection to the matches", () => {
    const sel = useSelection();
    sel.selectAll(filterKeys(state, f()));
    expect(sel.keys().sort()).toEqual(["a.key", "b.key", "c.key"]);
    // Filter changes → EditorView calls pruneTo(filteredKeys).
    sel.pruneTo(filterKeys(state, f({ text: "key:/^a/" })));
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
