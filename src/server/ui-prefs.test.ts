import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUiPrefs, saveUiPrefs, defaultUiPrefsPath } from "./ui-prefs.js";
import { createApi } from "./api.js";
import { saveState } from "./state.js";
import { defaultState } from "./schema.js";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "glot-uiprefs-")), "ui.json");

function apiSetup() {
  const dir = mkdtempSync(join(tmpdir(), "glot-uiprefs-api-"));
  const statePath = join(dir, "glotfile.json");
  saveState(statePath, defaultState());
  const uiPrefsPath = join(dir, "ui.json");
  return { uiPrefsPath, app: createApi({ statePath, uiPrefsPath }) };
}

describe("ui-prefs", () => {
  it("defaults to system theme when the file is missing", () => {
    expect(loadUiPrefs(join(tmpdir(), "glot-uiprefs-missing", "nope.json"))).toEqual({ theme: "system" });
  });

  it("round-trips a saved theme", () => {
    const path = tmpFile();
    saveUiPrefs(path, { theme: "dark" });
    expect(loadUiPrefs(path)).toEqual({ theme: "dark" });
  });

  it("falls back to system when the file is corrupt", () => {
    const path = tmpFile();
    writeFileSync(path, "{ this is not json", "utf8");
    expect(loadUiPrefs(path)).toEqual({ theme: "system" });
  });

  it("falls back to system when the stored theme is not a known value", () => {
    const path = tmpFile();
    writeFileSync(path, JSON.stringify({ theme: "chartreuse" }), "utf8");
    expect(loadUiPrefs(path)).toEqual({ theme: "system" });
  });

  it("merges so unknown keys survive a theme write", () => {
    const path = tmpFile();
    writeFileSync(path, JSON.stringify({ theme: "light", density: "compact" }), "utf8");
    saveUiPrefs(path, { theme: "dark" });
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk.theme).toBe("dark");
    expect(onDisk.density).toBe("compact");
  });

  it("creates the parent directory when it does not exist", () => {
    const path = join(mkdtempSync(join(tmpdir(), "glot-uiprefs-")), "nested", "ui.json");
    saveUiPrefs(path, { theme: "light" });
    expect(existsSync(path)).toBe(true);
    expect(loadUiPrefs(path)).toEqual({ theme: "light" });
  });

  it("round-trips saved panel widths", () => {
    const path = tmpFile();
    saveUiPrefs(path, { theme: "dark", keyColumnWidth: 340, detailPanelWidth: 500 });
    expect(loadUiPrefs(path)).toEqual({ theme: "dark", keyColumnWidth: 340, detailPanelWidth: 500 });
  });

  it("omits panel widths that are missing or out of range", () => {
    const path = tmpFile();
    writeFileSync(path, JSON.stringify({ keyColumnWidth: "wide", detailPanelWidth: 9999 }), "utf8");
    expect(loadUiPrefs(path)).toEqual({ theme: "system" });
  });

  it("defaultUiPrefsPath points at ~/.glotfile/ui.json", () => {
    expect(defaultUiPrefsPath().endsWith(join(".glotfile", "ui.json"))).toBe(true);
  });
});

describe("ui-prefs api", () => {
  it("GET /ui-prefs returns the system default when nothing is stored", async () => {
    const { app } = apiSetup();
    const res = await app.request("/ui-prefs");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ theme: "system" });
  });

  it("PUT /ui-prefs persists a valid theme", async () => {
    const { app, uiPrefsPath } = apiSetup();
    const res = await app.request("/ui-prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "dark" }),
    });
    expect(res.status).toBe(200);
    expect(loadUiPrefs(uiPrefsPath)).toEqual({ theme: "dark" });
    const get = await app.request("/ui-prefs");
    expect(await get.json()).toEqual({ theme: "dark" });
  });

  it("PUT /ui-prefs persists a panel width without touching the theme", async () => {
    const { app, uiPrefsPath } = apiSetup();
    saveUiPrefs(uiPrefsPath, { theme: "dark" });
    const res = await app.request("/ui-prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ detailPanelWidth: 512 }),
    });
    expect(res.status).toBe(200);
    expect(loadUiPrefs(uiPrefsPath)).toEqual({ theme: "dark", detailPanelWidth: 512 });
  });

  it("PUT /ui-prefs rejects an out-of-range panel width with 400", async () => {
    const { app, uiPrefsPath } = apiSetup();
    const res = await app.request("/ui-prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyColumnWidth: 12 }),
    });
    expect(res.status).toBe(400);
    expect(existsSync(uiPrefsPath)).toBe(false);
  });

  it("PUT /ui-prefs rejects a body with no recognized preferences", async () => {
    const { app } = apiSetup();
    const res = await app.request("/ui-prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ density: "compact" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /ui-prefs rejects an unknown theme with 400", async () => {
    const { app, uiPrefsPath } = apiSetup();
    const res = await app.request("/ui-prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "chartreuse" }),
    });
    expect(res.status).toBe(400);
    expect(existsSync(uiPrefsPath)).toBe(false);
  });
});
