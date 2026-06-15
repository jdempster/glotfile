import { describe, it, expect } from "vitest";
import { mergeStates } from "./merge.js";
import type { State, KeyEntry } from "../schema.js";

// A minimal en→fr,de state factory. Keys are passed in directly.
function makeState(keys: Record<string, KeyEntry>, extra?: Partial<State>): State {
  return {
    version: 1,
    config: { sourceLocale: "en", locales: ["en", "fr", "de"], outputs: [{ adapter: "angular-xliff", path: "x" }] },
    glossary: [],
    keys,
    ...extra,
  } as unknown as State;
}

const scalar = (en: string, rest: Record<string, { value: string; state?: string }> = {}): KeyEntry => ({
  values: {
    en: { value: en, state: "source" },
    ...Object.fromEntries(Object.entries(rest).map(([l, v]) => [l, { value: v.value, state: v.state ?? "reviewed" }])),
  },
} as unknown as KeyEntry);

describe("mergeStates", () => {
  it("adds keys present only in the import and stamps createdAt", () => {
    const existing = makeState({ a: scalar("A") });
    const incoming = makeState({ a: scalar("A"), b: scalar("B") });
    const { state, plan } = mergeStates(existing, incoming);
    expect(plan.added).toEqual(["b"]);
    expect(state.keys.b!.values.en!.value).toBe("B");
    expect(state.keys.b!.createdAt).toBeTruthy();
  });

  it("leaves an unchanged key untouched and counts it", () => {
    const existing = makeState({ a: scalar("A", { fr: { value: "Af" } }) });
    const incoming = makeState({ a: scalar("A") });
    const { state, plan } = mergeStates(existing, incoming);
    expect(plan.unchanged).toBe(1);
    expect(plan.sourceChanged).toEqual([]);
    expect(state.keys.a!.values.fr!.value).toBe("Af");
    expect(state.keys.a!.values.fr!.state).toBe("reviewed");
  });

  it("flags translations needs-review when source changes, keeping their text", () => {
    const existing = makeState({ a: scalar("A", { fr: { value: "Af" }, de: { value: "Ad" } }) });
    const incoming = makeState({ a: scalar("A v2") });
    const { state, plan } = mergeStates(existing, incoming);
    expect(plan.sourceChanged).toEqual(["a"]);
    expect(state.keys.a!.values.en!.value).toBe("A v2");
    expect(state.keys.a!.values.fr).toMatchObject({ value: "Af", state: "needs-review" });
    expect(state.keys.a!.values.de).toMatchObject({ value: "Ad", state: "needs-review" });
  });

  it("adopts a non-empty incoming translation into an empty locale", () => {
    const existing = makeState({ a: scalar("A") });
    const incoming = makeState({ a: scalar("A", { fr: { value: "Bonjour" } }) });
    const { state, plan } = mergeStates(existing, incoming);
    expect(plan.adopted).toEqual([{ key: "a", locale: "fr" }]);
    expect(state.keys.a!.values.fr).toMatchObject({ value: "Bonjour", state: "reviewed" });
  });

  it("never downgrades an existing translation with an incoming one", () => {
    const existing = makeState({ a: scalar("A", { fr: { value: "Mine", state: "reviewed" } }) });
    const incoming = makeState({ a: scalar("A", { fr: { value: "Theirs" } }) });
    const { state, plan } = mergeStates(existing, incoming);
    expect(plan.adopted).toEqual([]);
    expect(state.keys.a!.values.fr!.value).toBe("Mine");
  });

  it("ignores incoming translations for locales not in config", () => {
    const existing = makeState({ a: scalar("A") });
    const incoming = makeState({ a: scalar("A", { fr: { value: "Bonjour" }, es: { value: "Hola" } }) });
    const { state } = mergeStates(existing, incoming);
    expect(state.keys.a!.values.es).toBeUndefined();
  });

  it("reports removed keys but keeps them unless prune", () => {
    const existing = makeState({ a: scalar("A"), gone: scalar("Gone") });
    const incoming = makeState({ a: scalar("A") });
    const kept = mergeStates(existing, incoming);
    expect(kept.plan.removed).toEqual(["gone"]);
    expect(kept.state.keys.gone).toBeDefined();
    const pruned = mergeStates(existing, incoming, { prune: true });
    expect(pruned.state.keys.gone).toBeUndefined();
  });

  it("preserves glossary, config, context, notes and descriptions", () => {
    const existing = makeState(
      {
        a: {
          ...scalar("A", { fr: { value: "Af" } }),
          context: "AI context",
          contextSource: "ai",
          contextAt: "2026-01-01",
          notes: [{ id: "n1", text: "hi", at: "2026-01-01" }],
          description: "human desc",
        } as unknown as KeyEntry,
      },
      { glossary: [{ term: "Glotfile", doNotTranslate: true }] as unknown as State["glossary"] },
    );
    const incoming = makeState({ a: { ...scalar("A v2"), description: "imported desc" } as unknown as KeyEntry });
    const { state } = mergeStates(existing, incoming);
    expect(state.glossary).toEqual([{ term: "Glotfile", doNotTranslate: true }]);
    expect(state.config.outputs[0]!.adapter).toBe("angular-xliff");
    expect(state.keys.a!.context).toBe("AI context");
    expect(state.keys.a!.notes).toHaveLength(1);
    // Source changed but the human description wins over the import's.
    expect(state.keys.a!.description).toBe("human desc");
  });

  it("treats a key absent from liveKeys as removed even when the parse still has it", () => {
    // Simulates Angular: "orphan" lingers in a stale messages.<locale>.xlf export
    // but is gone from the source messages.xlf, so only "a" is live.
    const existing = makeState({ a: scalar("A"), orphan: scalar("Orphan") });
    const incoming = makeState({ a: scalar("A"), orphan: scalar("Orphan") });
    const { state, plan } = mergeStates(existing, incoming, { liveKeys: new Set(["a"]) });
    expect(plan.removed).toEqual(["orphan"]);
    expect(state.keys.orphan).toBeDefined();
    const pruned = mergeStates(existing, incoming, { liveKeys: new Set(["a"]), prune: true });
    expect(pruned.state.keys.orphan).toBeUndefined();
  });

  it("does not add an incoming key that is not live", () => {
    const existing = makeState({ a: scalar("A") });
    const incoming = makeState({ a: scalar("A"), stray: scalar("Stray") });
    const { state, plan } = mergeStates(existing, incoming, { liveKeys: new Set(["a"]) });
    expect(plan.added).toEqual([]);
    expect(state.keys.stray).toBeUndefined();
  });

  it("does not mutate the existing state object", () => {
    const existing = makeState({ a: scalar("A") });
    const incoming = makeState({ a: scalar("A v2"), b: scalar("B") });
    mergeStates(existing, incoming);
    expect(existing.keys.b).toBeUndefined();
    expect(existing.keys.a!.values.en!.value).toBe("A");
  });
});
