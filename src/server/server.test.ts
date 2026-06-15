import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./server.js";
import { saveState } from "./state.js";
import { defaultState } from "./schema.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "glot-"));
  const statePath = join(dir, "glotfile.json");
  saveState(statePath, defaultState());
  const uiDir = join(dir, "ui");
  mkdirSync(join(uiDir, "assets"), { recursive: true });
  writeFileSync(join(uiDir, "index.html"), "<!doctype html><div id=app></div>");
  writeFileSync(join(uiDir, "assets", "app.js"), "console.log('hi')");
  return buildApp({ statePath, uiDir });
}

describe("server static serving", () => {
  it("serves index.html at /", async () => {
    const res = await setup().request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("id=app");
  });
  it("serves built assets with correct content-type", async () => {
    const res = await setup().request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("console.log");
  });
  it("falls back to index.html for unknown SPA routes", async () => {
    const res = await setup().request("/keys/auth.signIn");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("id=app");
  });
  it("serves the /api routes under the same app", async () => {
    const res = await setup().request("/api/state");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.sourceLocale).toBe("en");
  });
  it("does not traverse outside uiDir", async () => {
    // a traversal attempt should fall back to index.html, never read outside
    const res = await setup().request("/../../etc/passwd");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("id=app");
  });
});

describe("server Host allowlist (DNS-rebinding / CSRF defense)", () => {
  it("rejects requests whose Host is not local", async () => {
    const res = await setup().request("http://evil.example.com/api/state");
    expect(res.status).toBe(403);
  });

  it("allows localhost and 127.0.0.1 hosts", async () => {
    expect((await setup().request("http://localhost/api/state")).status).toBe(200);
    expect((await setup().request("http://127.0.0.1:3000/api/state")).status).toBe(200);
  });
});

describe("server dev landing page", () => {
  function devApp() {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const statePath = join(dir, "glotfile.json");
    saveState(statePath, defaultState());
    return buildApp({ statePath, dev: true });
  }

  it("serves a 'use the Vite UI' page at / instead of a bare 404", async () => {
    const res = await devApp().request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("5173");
    expect(body).toMatch(/API only/i);
  });

  it("still serves /api in dev", async () => {
    const res = await devApp().request("/api/state");
    expect(res.status).toBe(200);
  });
});

describe("server screenshot serving", () => {
  function setupShots() {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const statePath = join(dir, "glotfile.json");
    saveState(statePath, defaultState());
    const uiDir = join(dir, "ui");
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, "index.html"), "<!doctype html><div id=app></div>");
    const shotsDir = join(dir, "glotfile-screenshots");
    mkdirSync(shotsDir, { recursive: true });
    const png = new Uint8Array([137, 80, 78, 71]);
    writeFileSync(join(shotsDir, "shot.png"), png);
    return { app: buildApp({ statePath, uiDir }), png };
  }

  it("serves an uploaded screenshot with an image content-type and its bytes", async () => {
    const { app, png } = setupShots();
    const res = await app.request("/glotfile-screenshots/shot.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
  });

  it("does not serve files outside the screenshots dir via traversal", async () => {
    const { app } = setupShots();
    const res = await app.request("/glotfile-screenshots/../../etc/passwd");
    // never the requested file: either 404 or a safe response, but not /etc/passwd
    if (res.status === 200) {
      expect(await res.text()).not.toContain("root:");
    } else {
      expect(res.status).toBe(404);
    }
  });

  it("returns 404 for a missing screenshot (no SPA fallback)", async () => {
    const { app } = setupShots();
    const res = await app.request("/glotfile-screenshots/nope.png");
    expect(res.status).toBe(404);
  });

  it("serves screenshots for the active file after switching to a glotfile in a subfolder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const statePath = join(dir, "glotfile.json");
    saveState(statePath, defaultState());
    const sub = join(dir, "examples");
    mkdirSync(sub, { recursive: true });
    saveState(join(sub, "demo.glotfile.json"), defaultState());
    const uiDir = join(dir, "ui");
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, "index.html"), "<!doctype html>");
    const app = buildApp({ statePath, uiDir });

    const sw = await app.request("/api/file", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "examples/demo.glotfile.json" }),
    });
    expect(sw.status).toBe(200);
    await app.request("/api/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "shot.png");
    const up = await app.request("/api/keys/k/screenshot", { method: "POST", body: fd });
    expect(up.status).toBe(200);
    const { path } = await up.json();
    // Stored relative to the glotfile's own dir, so file and images move together.
    expect(existsSync(join(sub, path))).toBe(true);

    // The UI fetches "/" + path — serving must follow the active file's dir.
    const res = await app.request("/" + path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });
});
