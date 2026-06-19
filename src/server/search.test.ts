import { describe, it, expect } from "vitest";
import { parseSearch, keyMatchesSearch } from "./search.js";
import type { KeyEntry } from "./schema.js";

const entries: Record<string, KeyEntry> = {
  "auth.signIn": { context: "Primary CTA on the login screen", values: { en: { value: "Sign in", state: "source" }, fr: { value: "Se connecter", state: "reviewed" } } },
  "cart.items": { plural: { arg: "count" }, values: { en: { forms: { other: "{count} items" }, state: "source" }, fr: { forms: { other: "{count} articles" }, state: "machine" } } },
  "nav.home": { context: "Top navigation", values: { en: { value: "Home", state: "source" } } },
};

const match = (query: string) =>
  Object.keys(entries).sort().filter((k) => keyMatchesSearch(k, entries[k]!, parseSearch(query)));

describe("parseSearch", () => {
  it("defaults to the 'all' scope with a substring needle", () => {
    expect(parseSearch("hello")).toEqual({ scope: "all", mode: "substring", needle: "hello", regex: null });
  });
  it("recognises scope prefixes case-insensitively", () => {
    expect(parseSearch("KEY:Auth").scope).toBe("key");
    expect(parseSearch("value:x").scope).toBe("value");
    expect(parseSearch("context:x").scope).toBe("context");
  });
  it("treats an unknown prefix as a literal substring over everything", () => {
    expect(parseSearch("foo:bar")).toEqual({ scope: "all", mode: "substring", needle: "foo:bar", regex: null });
  });
  it("parses /…/ as a regex and an empty term as no constraint", () => {
    expect(parseSearch("/^a/").mode).toBe("regex");
    expect(parseSearch("value:").mode).toBe("none");
    expect(parseSearch("/a(/").mode).toBe("invalid-regex");
  });
});

describe("keyMatchesSearch", () => {
  it("no prefix searches key, value and context", () => {
    expect(match("items")).toEqual(["cart.items"]);
    expect(match("screen")).toEqual(["auth.signIn"]);
  });
  it("key: scopes to the key name", () => {
    expect(match("key:home")).toEqual(["nav.home"]);
    expect(match("key:connecter")).toEqual([]);
  });
  it("value: scopes to translations, including plural forms", () => {
    expect(match("value:connecter")).toEqual(["auth.signIn"]);
    expect(match("value:articles")).toEqual(["cart.items"]);
    expect(match("value:auth")).toEqual([]);
  });
  it("context: scopes to context notes", () => {
    expect(match("context:navigation")).toEqual(["nav.home"]);
    expect(match("context:connecter")).toEqual([]);
  });
  it("regex matches over the scope and is case-insensitive", () => {
    expect(match("/^auth\\./")).toEqual(["auth.signIn"]);
    expect(match("key:/^NAV/")).toEqual(["nav.home"]);
    expect(match("value:/se connecter/")).toEqual(["auth.signIn"]);
  });
  it("an invalid regex matches nothing; an empty query matches everything", () => {
    expect(match("/auth(/")).toEqual([]);
    expect(match("")).toEqual(["auth.signIn", "cart.items", "nav.home"]);
  });
});
