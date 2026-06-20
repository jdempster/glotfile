import { describe, it, expect, vi, afterEach } from "vitest";
import { multilingualVisible, toggleMultilingual } from "./multilingualLocales.js";

const AI = { provider: "anthropic", model: "m", endpoint: null, region: null, batchSize: 25 };

// The store holds app-wide reactive state and talks to /local-settings, so each
// test loads a fresh copy of the module with fetch stubbed to a given response.
async function loadStore(opts: { serverValue?: string[] | null } = {}) {
  vi.resetModules();
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          init?.method === "PUT"
            ? { ok: true }
            : { ai: AI, editor: "vscode", multilingualLocales: opts.serverValue ?? null },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("./multilingualLocales.js");
  return { ...mod, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("multilingualLocales store", () => {
  it("defaults to null (show all) before hydration", async () => {
    const { multilingualLocales } = await loadStore();
    expect(multilingualLocales.value).toBeNull();
  });

  it("setMultilingualLocales updates the ref and PUTs the patch", async () => {
    const { multilingualLocales, setMultilingualLocales, fetchMock } = await loadStore();
    setMultilingualLocales(["fr", "de"]);
    expect(multilingualLocales.value).toEqual(["fr", "de"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local-settings",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ multilingualLocales: ["fr", "de"] }) }),
    );
  });

  it("hydrate adopts a server array", async () => {
    const { multilingualLocales, hydrateMultilingualLocales } = await loadStore({ serverValue: ["es"] });
    await hydrateMultilingualLocales();
    expect(multilingualLocales.value).toEqual(["es"]);
  });

  it("hydrate keeps null when the server stores null", async () => {
    const { multilingualLocales, hydrateMultilingualLocales } = await loadStore({ serverValue: null });
    await hydrateMultilingualLocales();
    expect(multilingualLocales.value).toBeNull();
  });
});

describe("multilingualVisible", () => {
  const all = ["en", "fr", "de", "es"];

  it("shows source first, then every target sorted by language name", () => {
    // French, German, Spanish — alphabetical by name.
    expect(multilingualVisible("en", all, null)).toEqual(["en", "fr", "de", "es"]);
  });

  it("orders targets by language name, not config order", () => {
    // Config lists German (de) before French (fr); by name French sorts first.
    expect(multilingualVisible("en", ["en", "de", "fr"], null)).toEqual(["en", "fr", "de"]);
  });

  it("restricts to the subset, sorted by name and excluding the source", () => {
    expect(multilingualVisible("en", all, ["es", "fr"])).toEqual(["en", "fr", "es"]);
  });

  it("drops a selected locale that no longer exists in the config", () => {
    expect(multilingualVisible("en", all, ["fr", "pt"])).toEqual(["en", "fr"]);
  });

  it("ignores the source even if it appears in the subset", () => {
    expect(multilingualVisible("en", all, ["en", "de"])).toEqual(["en", "de"]);
  });

  it("shows only the source when the subset is empty", () => {
    expect(multilingualVisible("en", all, [])).toEqual(["en"]);
  });
});

describe("toggleMultilingual", () => {
  const targets = ["fr", "de", "es"];

  it("unchecking from 'all' yields the remaining targets in order", () => {
    expect(toggleMultilingual(targets, null, "de")).toEqual(["fr", "es"]);
  });

  it("checking the last missing target collapses back to null (= all)", () => {
    expect(toggleMultilingual(targets, ["fr", "de"], "es")).toBeNull();
  });

  it("adds a target to an existing subset, keeping config order", () => {
    expect(toggleMultilingual(targets, ["es"], "fr")).toEqual(["fr", "es"]);
  });

  it("refuses to remove the only remaining target", () => {
    expect(toggleMultilingual(targets, ["fr"], "fr")).toEqual(["fr"]);
  });
});
