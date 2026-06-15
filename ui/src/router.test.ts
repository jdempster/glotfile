import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { navigate, setLeaveGuard, getHashSearch, setHashSearch } from "./router.js";

describe("navigate", () => {
  beforeEach(() => {
    location.hash = "";
  });

  it("resets the query string when navigating to another route", () => {
    // The query string is editor-scoped filter state; it must not leak into
    // other routes (drilldown.ts relies on the hash carrying no query state).
    location.hash = "#editor?q=foo&states=missing";
    navigate("analytics");
    expect(location.hash).toBe("#analytics");
  });

  it("resets the query string when re-navigating to the same route", () => {
    location.hash = "#editor?q=foo";
    navigate("editor");
    expect(location.hash).toBe("#editor");
  });

  it("navigates cleanly when there is no query string to begin with", () => {
    location.hash = "#editor";
    navigate("glossary");
    expect(location.hash).toBe("#glossary");
  });
});

describe("leave guard", () => {
  beforeEach(() => {
    location.hash = "#editor";
  });
  afterEach(() => {
    setLeaveGuard(null);
  });

  it("proceeds when the guard allows the navigation", () => {
    setLeaveGuard(() => true);
    navigate("analytics");
    expect(location.hash).toBe("#analytics");
  });

  it("aborts the navigation when the guard blocks it", () => {
    setLeaveGuard(() => false);
    navigate("analytics");
    expect(location.hash).toBe("#editor");
  });

  it("passes the destination route to the guard", () => {
    let seen: string | null = null;
    setLeaveGuard((to) => {
      seen = to;
      return false;
    });
    navigate("glossary");
    expect(seen).toBe("glossary");
  });

  it("navigates freely again once the guard is cleared", () => {
    setLeaveGuard(() => false);
    setLeaveGuard(null);
    navigate("analytics");
    expect(location.hash).toBe("#analytics");
  });
});

describe("hash search round-trip (filter state)", () => {
  beforeEach(() => {
    location.hash = "#editor";
  });

  it("preserves a ^-anchored regex query through the hash, route intact", () => {
    const p = new URLSearchParams();
    // The regex includes '?' — the very character parseHash() splits the hash on.
    p.set("q", "^auth\\.(login|logout)?$");
    setHashSearch(p);
    // Round-trips byte-identical: the regex '?' is percent-encoded in the hash,
    // so the only literal '?' is the route/search separator.
    expect(getHashSearch().get("q")).toBe("^auth\\.(login|logout)?$");
    expect(location.hash.startsWith("#editor?")).toBe(true);
  });
});
