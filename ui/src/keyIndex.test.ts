import { describe, it, expect, beforeEach } from "vitest";
import { knownKeys, knownLocales, syncKnownKeys, syncKnownLocales, addKnownKey } from "./keyIndex";
import type { State } from "./types";

function stateWith(keys: string[]): State {
  return { keys: Object.fromEntries(keys.map((k) => [k, { values: {} }])) } as unknown as State;
}

function stateWithLocales(sourceLocale: string, locales: string[]): State {
  return { keys: {}, config: { sourceLocale, locales } } as unknown as State;
}

describe("keyIndex", () => {
  beforeEach(() => { knownKeys.value = new Set(); knownLocales.value = new Set(); });

  it("syncKnownKeys mirrors the project's key paths", () => {
    syncKnownKeys(stateWith(["plant.water", "plant.feed"]));
    expect(knownKeys.value).toEqual(new Set(["plant.water", "plant.feed"]));
  });

  it("addKnownKey registers a single new key without dropping the rest", () => {
    syncKnownKeys(stateWith(["plant.water"]));
    addKnownKey("plant.repot");
    expect(knownKeys.value.has("plant.repot")).toBe(true);
    expect(knownKeys.value.has("plant.water")).toBe(true);
  });

  it("addKnownKey assigns a fresh Set (so the chat's link computed re-runs)", () => {
    const before = knownKeys.value;
    addKnownKey("plant.repot");
    expect(knownKeys.value).not.toBe(before);
  });

  it("addKnownKey is a no-op for a key already known", () => {
    syncKnownKeys(stateWith(["plant.water"]));
    const before = knownKeys.value;
    addKnownKey("plant.water");
    expect(knownKeys.value).toBe(before);
  });

  it("syncKnownLocales mirrors target locales, lowercased and excluding the source", () => {
    syncKnownLocales(stateWithLocales("en", ["en", "de", "pt-BR"]));
    expect(knownLocales.value).toEqual(new Set(["de", "pt-br"]));
  });
});
