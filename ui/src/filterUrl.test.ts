import { describe, it, expect } from "vitest";
import { filterFromUrl, filterToUrl, EMPTY_FILTER } from "./filterUrl.js";
import type { UrlState } from "./filterUrl.js";

function params(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj);
}

const BASE: UrlState = {
  filter: { ...EMPTY_FILTER },
  sort: "key-asc",
  locales: null,
};

describe("filterFromUrl", () => {
  it("empty params → defaults", () => {
    const result = filterFromUrl(new URLSearchParams());
    expect(result).toEqual(BASE);
  });

  it("parses text search", () => {
    const result = filterFromUrl(params({ q: "hello" }));
    expect(result.filter.text).toBe("hello");
  });

  it("parses comma-separated states", () => {
    const result = filterFromUrl(params({ states: "missing,machine" }));
    expect(result.filter.states).toEqual(["missing", "machine"]);
  });

  it("ignores unknown state values", () => {
    const result = filterFromUrl(params({ states: "missing,bogus" }));
    expect(result.filter.states).toEqual(["missing"]);
  });

  it("parses comma-separated issues", () => {
    const result = filterFromUrl(params({ issues: "spelling,placeholder" }));
    expect(result.filter.issues).toEqual(["spelling", "placeholder"]);
  });

  it("ignores unknown issue values", () => {
    const result = filterFromUrl(params({ issues: "spelling,notacheck" }));
    expect(result.filter.issues).toEqual(["spelling"]);
  });

  it("parses plurality", () => {
    const result = filterFromUrl(params({ plurality: "plural" }));
    expect(result.filter.plurality).toEqual(["plural"]);
  });

  it("parses boolean flags", () => {
    const result = filterFromUrl(params({ attention: "1", emptySource: "1", aiContext: "1", noUsages: "1", skipTranslate: "1" }));
    expect(result.filter.needsAttention).toBe(true);
    expect(result.filter.emptySource).toBe(true);
    expect(result.filter.aiContextUnreviewed).toBe(true);
    expect(result.filter.noUsages).toBe(true);
    expect(result.filter.skipTranslate).toBe(true);
  });

  it("boolean flags default to false when absent", () => {
    const result = filterFromUrl(new URLSearchParams());
    expect(result.filter.needsAttention).toBe(false);
    expect(result.filter.emptySource).toBe(false);
    expect(result.filter.aiContextUnreviewed).toBe(false);
    expect(result.filter.noUsages).toBe(false);
    expect(result.filter.skipTranslate).toBe(false);
  });

  it("parses sort", () => {
    const result = filterFromUrl(params({ sort: "created" }));
    expect(result.sort).toBe("created");
  });

  it("defaults sort to key-asc for unknown value", () => {
    const result = filterFromUrl(params({ sort: "bogus" }));
    expect(result.sort).toBe("key-asc");
  });

  it("parses tag", () => {
    const result = filterFromUrl(params({ tag: "ui" }));
    expect(result.filter.tag).toBe("ui");
  });

  it("parses a locales subset, lowercased and de-duped", () => {
    expect(filterFromUrl(params({ locales: "FR,de,fr" })).locales).toEqual(["fr", "de"]);
  });

  it("treats an absent or empty locales param as null (show all)", () => {
    expect(filterFromUrl(new URLSearchParams()).locales).toBeNull();
    expect(filterFromUrl(params({ locales: "" })).locales).toBeNull();
  });
});

describe("filterToUrl", () => {
  it("default state → empty params", () => {
    expect(filterToUrl(BASE).toString()).toBe("");
  });

  it("omits default sort", () => {
    const p = filterToUrl({ ...BASE, sort: "key-asc" });
    expect(p.has("sort")).toBe(false);
  });

  it("encodes a locales subset and omits it when null", () => {
    expect(filterToUrl({ ...BASE, locales: ["fr", "de"] }).get("locales")).toBe("fr,de");
    expect(filterToUrl({ ...BASE, locales: null }).has("locales")).toBe(false);
    expect(filterToUrl({ ...BASE, locales: [] }).has("locales")).toBe(false);
  });

  it("round-trips the skipTranslate flag", () => {
    const p = filterToUrl({ ...BASE, filter: { ...BASE.filter, skipTranslate: true } });
    expect(p.get("skipTranslate")).toBe("1");
    expect(filterFromUrl(p).filter.skipTranslate).toBe(true);
  });

  it("encodes text", () => {
    const p = filterToUrl({ ...BASE, filter: { ...EMPTY_FILTER, text: "hello" } });
    expect(p.get("q")).toBe("hello");
  });

  it("encodes states as comma list", () => {
    const p = filterToUrl({ ...BASE, filter: { ...EMPTY_FILTER, states: ["missing", "machine"] } });
    expect(p.get("states")).toBe("missing,machine");
  });

  it("encodes boolean flags", () => {
    const p = filterToUrl({
      ...BASE,
      filter: { ...EMPTY_FILTER, needsAttention: true, emptySource: true, aiContextUnreviewed: true, noUsages: true },
    });
    expect(p.get("attention")).toBe("1");
    expect(p.get("emptySource")).toBe("1");
    expect(p.get("aiContext")).toBe("1");
    expect(p.get("noUsages")).toBe("1");
  });

  it("omits false boolean flags", () => {
    const p = filterToUrl(BASE);
    expect(p.has("attention")).toBe(false);
    expect(p.has("emptySource")).toBe(false);
    expect(p.has("aiContext")).toBe(false);
    expect(p.has("noUsages")).toBe(false);
  });
});

describe("filterFromUrl / filterToUrl round-trip", () => {
  it("all non-default values survive round-trip", () => {
    const input: UrlState = {
      filter: {
        text: "btn",
        tag: "ui",
        states: ["missing", "reviewed"],
        issues: ["spelling"],
        plurality: ["plural"],
        needsAttention: true,
        emptySource: true,
        aiContextUnreviewed: true,
        noUsages: true,
        skipTranslate: true,
      },
      sort: "created",
      locales: ["fr", "de"],
    };
    const result = filterFromUrl(filterToUrl(input));
    expect(result).toEqual(input);
  });

  it("default state round-trips to defaults", () => {
    const result = filterFromUrl(filterToUrl(BASE));
    expect(result).toEqual(BASE);
  });

  it("a ^-anchored regex query survives serialization to a query string and back", () => {
    // Mirror the real hash path: filterToUrl → toString() → new URLSearchParams()
    // (what router.setHashSearch/getHashSearch do). Every regex metacharacter
    // must come back byte-identical.
    const text = "^auth\\.(login|logout)\\d?$";
    const qs = filterToUrl({ ...BASE, filter: { ...EMPTY_FILTER, text } }).toString();
    expect(filterFromUrl(new URLSearchParams(qs)).filter.text).toBe(text);
  });

  it("percent-encodes a regex '?' so it can't be read as the route/search separator", () => {
    const qs = filterToUrl({ ...BASE, filter: { ...EMPTY_FILTER, text: "^colou?r" } }).toString();
    expect(qs).not.toContain("?");   // the only literal '?' allowed in a hash is the separator
    expect(qs).toContain("%3F");
    expect(filterFromUrl(new URLSearchParams(qs)).filter.text).toBe("^colou?r");
  });
});
