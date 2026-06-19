import { describe, it, expect } from "vitest";
import { defaultState } from "./schema.js";
import { createKey } from "./state.js";
import { runGet, applyOps, parseOps, staleableTargets, type ApplyOp } from "./agent-cli.js";

const CLOCK = () => "2026-06-15T00:00:00.000Z";

function fx() {
  const s = defaultState();
  s.config.sourceLocale = "en";
  s.config.locales = ["en", "fr", "de"];
  createKey(s, "auth.login", "Log in");
  s.keys["auth.login"]!.values.fr = { value: "Connexion", state: "reviewed" };
  // de left missing
  createKey(s, "auth.logout", "Log out");
  s.keys["auth.logout"]!.values.fr = { value: "Déconnexion", state: "machine" };
  s.keys["auth.logout"]!.values.de = { value: "Abmelden", state: "needs-review" };
  createKey(s, "home.title", "Welcome");
  return s;
}

describe("runGet", () => {
  it("lists matched keys sorted (keys-only overview)", () => {
    expect(runGet(fx(), {}).keys).toEqual(["auth.login", "auth.logout", "home.title"]);
    expect(runGet(fx(), { keyGlobs: ["auth.*"] }).keys).toEqual(["auth.login", "auth.logout"]);
    expect(runGet(fx(), { keyGlobs: ["auth.login", "home.title"] }).keys).toEqual(["auth.login", "home.title"]);
  });

  it("search filters by scope and regex, composing with key globs", () => {
    expect(runGet(fx(), { search: "key:logout" }).keys).toEqual(["auth.logout"]);
    // value: searches translations across locales (here a source value, then a de value).
    expect(runGet(fx(), { search: "value:Log in" }).keys).toEqual(["auth.login"]);
    expect(runGet(fx(), { search: "value:Abmelden" }).keys).toEqual(["auth.logout"]);
    // no prefix searches everything (home.title's source value).
    expect(runGet(fx(), { search: "Welcome" }).keys).toEqual(["home.title"]);
    // /…/ regex over the key.
    expect(runGet(fx(), { search: "/^home/" }).keys).toEqual(["home.title"]);
    // composes (AND) with key globs.
    expect(runGet(fx(), { keyGlobs: ["auth.*"], search: "value:Déconnexion" }).keys).toEqual(["auth.logout"]);
  });

  it("projects value+state per shown locale by default, missing cells included", () => {
    const json = runGet(fx(), { keyGlobs: ["auth.login"] }).json;
    expect(json).toEqual({
      "auth.login": {
        en: { value: "Log in", state: "source" },
        fr: { value: "Connexion", state: "reviewed" },
        de: { value: "", state: "missing" },
      },
    });
  });

  it("state filter selects keys by target state and shows source as reference", () => {
    const out = runGet(fx(), { locales: ["en", "de"], states: ["missing"] });
    expect(out.keys).toEqual(["auth.login", "home.title"]);
    expect(out.json).toEqual({
      "auth.login": { en: { value: "Log in", state: "source" }, de: { value: "", state: "missing" } },
      "home.title": { en: { value: "Welcome", state: "source" }, de: { value: "", state: "missing" } },
    });
  });

  it("--fields value narrows the projection", () => {
    const json = runGet(fx(), { keyGlobs: ["auth.login"], locales: ["fr"], fields: ["value"] }).json;
    expect(json).toEqual({ "auth.login": { fr: { value: "Connexion" } } });
  });

  it("--fields all returns the whole entry with values narrowed to shown locales", () => {
    const json = runGet(fx(), { keyGlobs: ["auth.login"], locales: ["en", "fr"], fields: ["all"] }).json as Record<string, any>;
    expect(Object.keys(json["auth.login"].values)).toEqual(["en", "fr"]);
    expect(json["auth.login"].values.fr).toEqual({ value: "Connexion", state: "reviewed" });
  });

  it("emits one ndjson row per (key, locale) cell", () => {
    const rows = runGet(fx(), { keyGlobs: ["auth.login"], locales: ["en", "de"] }).ndjson;
    expect(rows).toEqual([
      { key: "auth.login", locale: "en", value: "Log in", state: "source" },
      { key: "auth.login", locale: "de", value: "", state: "missing" },
    ]);
  });
});

describe("applyOps", () => {
  it("set-source updates the source and flips reviewed/machine targets to needs-review", () => {
    const s = fx();
    const r = applyOps(s, [{ op: "set-source", key: "auth.login", value: "Sign in" }], { clock: CLOCK });
    expect(r.applied).toBe(1);
    expect(r.keysTouched).toEqual(["auth.login"]);
    expect(s.keys["auth.login"]!.values.en!.value).toBe("Sign in");
    expect(s.keys["auth.login"]!.values.fr!.state).toBe("needs-review");
  });

  it("dispatches set-target (with state override), create, set-state and clear", () => {
    const s = fx();
    const ops: ApplyOp[] = [
      { op: "set-target", key: "auth.login", locale: "de", value: "Anmelden", state: "machine" },
      { op: "create", key: "home.cta", value: "Get started" },
      { op: "set-state", key: "auth.logout", locale: "de", state: "reviewed" },
      { op: "clear", key: "auth.logout", locale: "fr" },
    ];
    const r = applyOps(s, ops, { clock: CLOCK });
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(4);
    expect(s.keys["auth.login"]!.values.de).toEqual({ value: "Anmelden", state: "machine" });
    expect(s.keys["home.cta"]!.values.en!.value).toBe("Get started");
    expect(s.keys["auth.logout"]!.values.de!.state).toBe("reviewed");
    expect(s.keys["auth.logout"]!.values.fr).toBeUndefined();
  });

  it("stops at the first error by default (atomic — caller skips save)", () => {
    const s = fx();
    const ops: ApplyOp[] = [
      { op: "set-source", key: "auth.login", value: "Sign in" },
      { op: "set-source", key: "does.not.exist", value: "x" },
      { op: "set-source", key: "home.title", value: "Hi" },
    ];
    const r = applyOps(s, ops, { clock: CLOCK });
    expect(r.applied).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ index: 1, op: "set-source", key: "does.not.exist" });
    expect(s.keys["home.title"]!.values.en!.value).toBe("Welcome");
  });

  it("continueOnError applies the rest and collects errors", () => {
    const s = fx();
    const ops: ApplyOp[] = [
      { op: "set-source", key: "does.not.exist", value: "x" },
      { op: "set-source", key: "home.title", value: "Hi" },
    ];
    const r = applyOps(s, ops, { clock: CLOCK, continueOnError: true });
    expect(r.applied).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(s.keys["home.title"]!.values.en!.value).toBe("Hi");
  });
});

describe("parseOps", () => {
  it("parses a JSON array of ops", () => {
    expect(parseOps('[{"op":"clear","key":"a","locale":"fr"}]')).toEqual([{ op: "clear", key: "a", locale: "fr" }]);
  });
  it("rejects non-arrays and non-op objects", () => {
    expect(() => parseOps("{}")).toThrow(/array of operations/);
    expect(() => parseOps("[1]")).toThrow(/operation 0/);
    expect(() => parseOps("not json")).toThrow(/JSON array/);
  });
});

describe("staleableTargets", () => {
  it("counts reviewed/machine targets, ignores the source and needs-review/missing", () => {
    expect(staleableTargets(fx().keys["auth.logout"], "en")).toBe(1); // fr machine; de needs-review excluded
    expect(staleableTargets(fx().keys["auth.login"], "en")).toBe(1); // fr reviewed
    expect(staleableTargets(fx().keys["home.title"], "en")).toBe(0);
  });
});
