import { describe, it, expect, vi, afterEach } from "vitest";

// The module reads localStorage at import time and keeps app-wide reactive
// state, so each test loads a fresh copy with the cache and server stubbed.
async function loadPanelWidths(opts: { cached?: Record<string, string>; serverPrefs?: Record<string, unknown> } = {}) {
  vi.resetModules();
  localStorage.clear();
  for (const [k, v] of Object.entries(opts.cached ?? {})) localStorage.setItem(k, v);
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(init?.method === "PUT" ? { ok: true } : { theme: "system", ...opts.serverPrefs }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("@/panel-widths");
  return { ...mod, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("panel widths", () => {
  it("defaults to the previously hard-coded widths", async () => {
    const p = await loadPanelWidths();
    expect(p.keyColumn.width.value).toBe(272);
    expect(p.detailPanel.width.value).toBe(420);
  });

  it("boots from the localStorage cache, clamped to the panel range", async () => {
    const p = await loadPanelWidths({
      cached: { "glotfile-keyColumnWidth": "340", "glotfile-detailPanelWidth": "9999" },
    });
    expect(p.keyColumn.width.value).toBe(340);
    expect(p.detailPanel.width.value).toBe(720);
  });

  it("set clamps live updates without persisting", async () => {
    const p = await loadPanelWidths();
    p.keyColumn.set(50);
    expect(p.keyColumn.width.value).toBe(180);
    p.keyColumn.set(400.6);
    expect(p.keyColumn.width.value).toBe(401);
    expect(p.fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("glotfile-keyColumnWidth")).toBeNull();
  });

  it("commit caches the width and PUTs it to the server", async () => {
    const p = await loadPanelWidths();
    p.detailPanel.set(512);
    p.detailPanel.commit();
    expect(localStorage.getItem("glotfile-detailPanelWidth")).toBe("512");
    expect(p.fetchMock).toHaveBeenCalledWith(
      "/api/ui-prefs",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ detailPanelWidth: 512 }) }),
    );
  });

  it("reset returns to the default and persists it", async () => {
    const p = await loadPanelWidths({ cached: { "glotfile-keyColumnWidth": "340" } });
    p.keyColumn.reset();
    expect(p.keyColumn.width.value).toBe(272);
    expect(localStorage.getItem("glotfile-keyColumnWidth")).toBe("272");
  });

  it("syncPanelWidths adopts server widths and ignores absent ones", async () => {
    const p = await loadPanelWidths({ serverPrefs: { keyColumnWidth: 300 } });
    await p.syncPanelWidths();
    expect(p.keyColumn.width.value).toBe(300);
    expect(localStorage.getItem("glotfile-keyColumnWidth")).toBe("300");
    expect(p.detailPanel.width.value).toBe(420);
    expect(localStorage.getItem("glotfile-detailPanelWidth")).toBeNull();
  });
});
