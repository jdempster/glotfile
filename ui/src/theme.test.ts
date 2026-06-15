import { describe, it, expect, vi, afterEach } from "vitest";

// The theme module reads window.matchMedia and localStorage at import time and
// keeps app-wide reactive state, so each test loads a fresh copy with the
// environment (cache, OS preference, server response) stubbed up front.
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb),
    removeEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  };
  vi.stubGlobal("matchMedia", () => mql);
  return { emit: (next: boolean) => { mql.matches = next; listeners.forEach((cb) => cb({ matches: next })); } };
}

async function loadTheme(opts: { cached?: string; systemDark?: boolean; serverTheme?: string } = {}) {
  vi.resetModules();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  if (opts.cached) localStorage.setItem("glotfile-theme", opts.cached);
  const mq = stubMatchMedia(opts.systemDark ?? false);
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(init?.method === "PUT" ? { ok: true } : { theme: opts.serverTheme ?? "system" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("@/theme");
  return { ...mod, mq, fetchMock };
}

const hasDark = () => document.documentElement.classList.contains("dark");

afterEach(() => vi.unstubAllGlobals());

describe("theme store", () => {
  it("defaults to system mode and follows the OS preference", async () => {
    const t = await loadTheme({ systemDark: true });
    t.initTheme();
    expect(t.mode.value).toBe("system");
    expect(hasDark()).toBe(true);
  });

  it("a cached explicit mode overrides the OS preference", async () => {
    const t = await loadTheme({ cached: "light", systemDark: true });
    t.initTheme();
    expect(t.mode.value).toBe("light");
    expect(hasDark()).toBe(false);
  });

  it("setTheme applies the class, caches the choice, and PUTs it to the server", async () => {
    const t = await loadTheme({ systemDark: false });
    t.initTheme();
    t.setTheme("dark");
    expect(hasDark()).toBe(true);
    expect(localStorage.getItem("glotfile-theme")).toBe("dark");
    expect(t.fetchMock).toHaveBeenCalledWith(
      "/api/ui-prefs",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ theme: "dark" }) }),
    );
  });

  it("in system mode, an OS switch to dark flips the theme live", async () => {
    const t = await loadTheme({ systemDark: false });
    t.initTheme();
    expect(hasDark()).toBe(false);
    t.mq.emit(true);
    expect(hasDark()).toBe(true);
  });

  it("an explicit mode ignores OS changes", async () => {
    const t = await loadTheme({ cached: "light", systemDark: false });
    t.initTheme();
    t.mq.emit(true);
    expect(hasDark()).toBe(false);
  });

  it("syncFromServer adopts a differing server theme", async () => {
    const t = await loadTheme({ systemDark: false, serverTheme: "dark" });
    t.initTheme();
    expect(hasDark()).toBe(false);
    await t.syncFromServer();
    expect(t.mode.value).toBe("dark");
    expect(hasDark()).toBe(true);
    expect(localStorage.getItem("glotfile-theme")).toBe("dark");
  });
});
