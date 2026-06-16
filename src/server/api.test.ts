import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, symlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createApi } from "./api.js";
import { saveState, createKey, addNote } from "./state.js";
import { defaultState } from "./schema.js";
import { saveUsageCache } from "./scan.js";
import { createEventHub } from "./events.js";
import type { StateWatcher } from "./watch.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "glot-"));
  const file = join(dir, "glotfile.json");
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  saveState(file, s);
  return { file, app: createApi({ statePath: file }) };
}

function createKeyDirect(file: string) {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  createKey(s, "auth.in", "Sign in");
  saveState(file, s);
}

describe("api", () => {
  it("GET /state returns the state", async () => {
    const { app } = setup();
    const res = await app.request("/state");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.sourceLocale).toBe("en");
  });

  it("POST /keys creates a key and persists it", async () => {
    const { app, file } = setup();
    const res = await app.request("/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "a.b", value: "Hi" }),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(file, "utf8")).toContain('"a.b"');
  });

  it("POST /dictionary appends a custom word and persists it", async () => {
    const { app, file } = setup();
    const res = await app.request("/dictionary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word: "Glotfile" }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.config.spelling.customWords).toContain("Glotfile");
  });

  it("DELETE /dictionary/:word removes a custom word", async () => {
    const { app, file } = setup();
    await app.request("/dictionary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word: "Glotfile" }),
    });
    const res = await app.request(`/dictionary/${encodeURIComponent("Glotfile")}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.config.spelling.customWords).not.toContain("Glotfile");
  });

  it("POST /dictionary rejects a blank word", async () => {
    const { app } = setup();
    const res = await app.request("/dictionary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /keys requires a non-empty source value", async () => {
    const { app } = setup();
    const res = await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "   " }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/source value is required/i);
  });

  it("PUT /keys/:key/values/:locale sets a target value as reviewed", async () => {
    const { app, file } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const res = await app.request("/keys/k/values/fr", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "Salut" }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k.values.fr.state).toBe("reviewed");
  });

  it("PUT a value for the source locale keeps state 'source' (not reviewed)", async () => {
    const { app, file } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const res = await app.request("/keys/k/values/en", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "Hello" }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k.values.en).toEqual({ value: "Hello", state: "source" });
  });

  it("GET /scan/missing reports missing pairs", async () => {
    const { app } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const res = await app.request("/scan/missing");
    const body = await res.json();
    expect(body).toEqual([{ key: "k", locale: "fr" }]);
  });

  it("returns 400 with a message for a duplicate-key error (not an opaque 500)", async () => {
    const { app } = setup();
    const make = () => app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "dup", value: "Hi" }),
    });
    expect((await make()).status).toBe(200);
    const res = await make();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already exists/i);
  });

  it("returns 400 when deleting a missing key", async () => {
    const { app } = setup();
    const res = await app.request("/keys/nope", { method: "DELETE" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no such key/i);
  });

  it("GET /checks reports placeholder issues and honors the checks param", async () => {
    const { app, file } = setup();
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    s.keys = {
      greeting: { values: { en: { value: "Hi {name}", state: "source" }, fr: { value: "Salut", state: "reviewed" } } },
    };
    saveState(file, s);

    const res = await app.request("/checks?checks=placeholder");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spellPending).toBe(false);
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0]).toMatchObject({ key: "greeting", locale: "fr", check: "placeholder" });

    const none = await (await app.request("/checks?checks=length")).json();
    expect(none.issues).toHaveLength(0);
  });

  it("GET /lint returns the same report shape as `glotfile check` and honors rule skips", async () => {
    const { app, file } = setup();
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    s.keys = {
      greeting: { values: { en: { value: "Hi {name}", state: "source" }, fr: { value: "Salut", state: "reviewed" } } },
    };
    saveState(file, s);

    const res = await app.request("/lint");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.findings).toContainEqual(
      expect.objectContaining({ ruleId: "placeholder-mismatch", key: "greeting", locale: "fr", severity: "error" }),
    );
    expect(body.counts.error).toBeGreaterThan(0);

    // Turning the rule off in config.lint.rules removes it from the report.
    s.config.lint = { rules: { "placeholder-mismatch": "off" } };
    saveState(file, s);
    const skipped = await (await app.request("/lint")).json();
    expect(skipped.findings.some((f: { ruleId: string }) => f.ruleId === "placeholder-mismatch")).toBe(false);
  });

  it("GET /stats returns per-locale completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    saveState(file, s);
    const app = createApi({ statePath: file });
    createKeyDirect(file);

    const res = await app.request("/stats");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals.keys).toBe(1);
    expect(body.totals.locales).toBe(1);
    const fr = body.locales.find((l: { locale: string }) => l.locale === "fr");
    expect(fr.total).toBe(1);
    expect(fr.counts.missing).toBe(1);
  });

  it("PATCH /keys/:key with pluralArg renames a plural key's count variable", async () => {
    const { app, file } = setup();
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "cart.items", "{count} items", () => "2026-06-07T00:00:00.000Z", { plural: { arg: "count" } });
    saveState(file, s);
    const res = await app.request("/keys/cart.items", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pluralArg: "n" }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys["cart.items"].plural.arg).toBe("n");
  });

  it("PATCH /keys/:key with changed source flips existing target translations to needs-review", async () => {
    const { app, file } = setup();
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hello");
    s.keys["k"]!.values["fr"] = { value: "Bonjour", state: "reviewed", updatedAt: "2026-01-01T00:00:00.000Z" };
    saveState(file, s);
    const res = await app.request("/keys/k", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "Hello world" }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k.values.fr.state).toBe("needs-review");
    expect(saved.keys.k.values.fr.value).toBe("Bonjour");
  });

  it("PUT /keys/:key/values/:sourceLocale with changed source flips targets to needs-review", async () => {
    const { app, file } = setup();
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hello");
    s.keys["k"]!.values["fr"] = { value: "Bonjour", state: "reviewed", updatedAt: "2026-01-01T00:00:00.000Z" };
    saveState(file, s);
    const res = await app.request("/keys/k/values/en", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "Hello world" }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k.values.fr.state).toBe("needs-review");
  });

  it("PUT /keys/:key/values/:targetLocale does NOT flip other targets", async () => {
    const { app, file } = setup();
    const s = defaultState();
    s.config.locales = ["en", "fr", "de"];
    createKey(s, "k", "Hello");
    s.keys["k"]!.values["fr"] = { value: "Bonjour", state: "reviewed", updatedAt: "2026-01-01T00:00:00.000Z" };
    s.keys["k"]!.values["de"] = { value: "Hallo", state: "reviewed", updatedAt: "2026-01-01T00:00:00.000Z" };
    saveState(file, s);
    const res = await app.request("/keys/k/values/fr", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "Salut" }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k.values.de.state).toBe("reviewed");
  });
});

describe("PUT /config", () => {
  it("persists a valid config (adding a locale)", async () => {
    const { app } = setup();
    const cfg = { ...defaultState().config, locales: ["en", "fr", "es"] };
    const res = await app.request("/config", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const state = await (await app.request("/state")).json();
    // Locales are normalized to source-first, then alphabetical.
    expect(state.config.locales).toEqual(["en", "es", "fr"]);
  });

  it("strips removed locales' values from keys", async () => {
    const { app } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    await app.request("/keys/k/values/fr", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "Salut" }),
    });
    const cfg = { ...defaultState().config, locales: ["en"] };
    const res = await app.request("/config", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    });
    expect(res.status).toBe(200);
    const state = await (await app.request("/state")).json();
    expect(state.keys.k.values.fr).toBeUndefined();
    expect(state.keys.k.values.en.value).toBe("Hi");
  });

  it("rejects an invalid config (sourceLocale not in locales) with 400", async () => {
    const { app } = setup();
    const cfg = { ...defaultState().config, sourceLocale: "de", locales: ["en", "fr"] };
    const res = await app.request("/config", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/sourceLocale/i);
  });

  it("returns 400 (not 500) for a malformed config body with no locales array", async () => {
    const { app } = setup();
    const res = await app.request("/config", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceLocale: "en" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/locales/i);
  });
});

describe("glossary routes", () => {
  it("PUT then GET returns the entry; same term replaces", async () => {
    const { app } = setup();
    const put = (entry: unknown) => app.request("/glossary", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    expect((await put({ term: "Login", doNotTranslate: true })).status).toBe(200);
    let body = await (await app.request("/glossary")).json();
    expect(body).toHaveLength(1);
    expect(body[0].term).toBe("Login");
    await put({ term: "Login", notes: "verb" });
    body = await (await app.request("/glossary")).json();
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({ term: "Login", notes: "verb" });
  });

  it("PUT with a missing term returns 400", async () => {
    const { app } = setup();
    const res = await app.request("/glossary", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "no term" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  it("DELETE removes by term", async () => {
    const { app } = setup();
    await app.request("/glossary", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ term: "Login" }),
    });
    const res = await app.request("/glossary/Login", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await (await app.request("/glossary")).json()).toHaveLength(0);
  });
});

describe("screenshot routes", () => {
  it("uploads a file, references it, and writes it to disk", async () => {
    const { app, file } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "shot.png");
    const res = await app.request("/keys/k/screenshot", { method: "POST", body: fd });
    expect(res.status).toBe(200);
    const { path } = await res.json();
    expect(path).toMatch(/^glotfile-screenshots\//);

    const state = await (await app.request("/state")).json();
    expect(state.keys.k.screenshot).toBe(path);
    expect(existsSync(join(dirname(file), path))).toBe(true);
  });

  it("returns 400 when no file is uploaded", async () => {
    const { app } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const res = await app.request("/keys/k/screenshot", {
      method: "POST", body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE clears the screenshot reference", async () => {
    const { app } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "shot.png");
    await app.request("/keys/k/screenshot", { method: "POST", body: fd });
    const res = await app.request("/keys/k/screenshot", { method: "DELETE" });
    expect(res.status).toBe(200);
    const state = await (await app.request("/state")).json();
    expect(state.keys.k.screenshot).toBeUndefined();
  });

  async function upload(app: ReturnType<typeof createApi>, key: string, name = "shot.png") {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), name);
    const res = await app.request(`/keys/${key}/screenshot`, { method: "POST", body: fd });
    return (await res.json()).path as string;
  }

  it("deletes the screenshot FILE from disk when the key is deleted", async () => {
    const { app, file } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const path = await upload(app, "k");
    expect(existsSync(join(dirname(file), path))).toBe(true);
    await app.request("/keys/k", { method: "DELETE" });
    expect(existsSync(join(dirname(file), path))).toBe(false);
  });

  it("deletes the screenshot FILE from disk on DELETE screenshot", async () => {
    const { app, file } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const path = await upload(app, "k");
    await app.request("/keys/k/screenshot", { method: "DELETE" });
    expect(existsSync(join(dirname(file), path))).toBe(false);
  });

  it("re-uploading the same name overwrites in place (key-based filename)", async () => {
    const { app, file } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const first = await upload(app, "k", "shot.png");
    const second = await upload(app, "k", "shot.png");
    expect(second).toBe(first); // deterministic, derived from the key
    expect(existsSync(join(dirname(file), second))).toBe(true);
  });

  it("re-uploading a different name replaces and cleans up the old file", async () => {
    const { app, file } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const first = await upload(app, "k", "old.png");
    const second = await upload(app, "k", "new.png");
    expect(second).not.toBe(first);
    expect(existsSync(join(dirname(file), first))).toBe(false); // old cleaned up
    expect(existsSync(join(dirname(file), second))).toBe(true);
  });

  it("attaches the screenshot image to AI requests when the active file is in a subfolder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    saveState(file, defaultState());
    const sub = join(dir, "examples");
    mkdirSync(sub, { recursive: true });
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    saveState(join(sub, "demo.glotfile.json"), s);
    const seen: { image?: unknown }[] = [];
    const makeProvider = () => ({
      translate: async (reqs: { id: string; image?: unknown }[]) => {
        seen.push(...reqs);
        return reqs.map((r) => ({ id: r.id, translation: "Salut" }));
      },
      supportsVision: () => true,
    });
    const app = createApi({ statePath: file, makeProvider });

    await app.request("/file", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "examples/demo.glotfile.json" }),
    });
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    await upload(app, "k");
    const tr = await app.request("/translate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ onlyMissing: true }),
    });
    expect(tr.status).toBe(200);
    expect(seen).toHaveLength(1);
    // The screenshot lives next to the subfolder glotfile — it must reach the provider.
    expect(seen[0]!.image).toBeTruthy();
  });

  it("scopes the screenshots folder to the source file's name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "marketing.json");
    saveState(file, defaultState());
    const app = createApi({ statePath: file });
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const path = await upload(app, "k");
    expect(path).toMatch(/^marketing-screenshots\//);
    expect(existsSync(join(dir, path))).toBe(true);
  });
});

describe("file switcher routes", () => {
  it("GET /file returns the current file name", async () => {
    const { app } = setup();
    const res = await app.request("/file");
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("glotfile.json");
  });

  it("GET /file returns the project directory and folder name", async () => {
    const { app, file } = setup();
    const body = await (await app.request("/file")).json();
    expect(body.dir).toBe(dirname(resolve(file)));
    expect(body.project).toBe(basename(dirname(resolve(file))));
  });

  it("GET /files lists every loadable glotfile in the project root", async () => {
    const { app, file } = setup();
    const second = join(dirname(file), "other.glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "de"];
    saveState(second, s);
    const body = await (await app.request("/files")).json();
    const names = body.map((f: { name: string }) => f.name).sort();
    expect(names).toEqual(["glotfile.json", "other.glotfile.json"]);
  });

  it("lists a split catalog directory in GET /files", async () => {
    // Create a project dir with two catalogs:
    //   1. glotfile.json (single, active)
    //   2. other.glotfile/ (split directory) — must be discovered as other.glotfile.json
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const active = join(dir, "glotfile.json");
    saveState(active, defaultState());

    const splitLogical = join(dir, "other.glotfile.json");
    const s = defaultState();
    s.config.storage = "split";
    s.config.locales = ["en"];
    createKey(s, "x.key", "Hi");
    saveState(splitLogical, s);

    const app = createApi({ statePath: active });
    const res = await app.request("/files");
    const files = await res.json();
    const names = files.map((f: { name: string }) => f.name).sort();
    expect(names).toEqual(["glotfile.json", "other.glotfile.json"]);
  });

  it(".glotfile/ runtime directory is excluded from GET /files (no config.json inside)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const statePath = join(dir, "glotfile.json");
    const s = defaultState();
    createKey(s, "x.key", "Hi");
    saveState(statePath, s);

    // Simulate the .glotfile/ runtime dir that exists in real projects (usage.json, log.jsonl)
    // but has no config.json — the discovery loop must skip it.
    mkdirSync(join(dir, ".glotfile"));
    writeFileSync(join(dir, ".glotfile", "usage.json"), "{}");

    const app = createApi({ statePath });
    const res = await app.request("/files");
    const files = await res.json();
    const names = files.map((f: { name: string }) => f.name).sort();
    expect(names).toEqual(["glotfile.json"]);
  });

  it("POST /file switches the active file so /state reflects it", async () => {
    const { app, file } = setup();
    const second = join(dirname(file), "other.glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "de"];
    saveState(second, s);
    const res = await app.request("/file", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "other.glotfile.json" }),
    });
    expect(res.status).toBe(200);
    const state = await (await app.request("/state")).json();
    expect(state.config.locales).toEqual(["en", "de"]);
  });

  it("POST /file with a non-existent file returns 400", async () => {
    const { app } = setup();
    const res = await app.request("/file", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "nope.json" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not found/i);
  });

  it("POST /file with a path outside the project returns 400", async () => {
    const { app } = setup();
    const res = await app.request("/file", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../escape.json" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/outside the project/i);
  });
});

describe("DELETE /keys/:key/values/:locale", () => {
  it("clears a target locale's value so the state shows it gone", async () => {
    const { app, file } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    await app.request("/keys/k/values/fr", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "Salut" }),
    });
    const res = await app.request("/keys/k/values/fr", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k.values.fr).toBeUndefined();
    expect(saved.keys.k.values.en.value).toBe("Hi");
  });

  it("returns 400 when clearing the source locale", async () => {
    const { app } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const res = await app.request("/keys/k/values/en", { method: "DELETE" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/source value/i);
  });
});

describe("POST /translate + GET /log", () => {
  function setupWithProvider() {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    saveState(file, s);
    const makeProvider = () => ({
      translate: async (reqs: { id: string }[]) =>
        reqs.map((r) => ({ id: r.id, translation: "Salut" })),
      supportsVision: () => true,
    });
    return { dir, file, app: createApi({ statePath: file, makeProvider }) };
  }

  it("translates, then GET /log returns an entry reflecting the items and the goal", async () => {
    const { app } = setupWithProvider();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const tr = await app.request("/translate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ onlyMissing: true }),
    });
    expect(tr.status).toBe(200);
    const trBody = await tr.json();
    expect(trBody.requested).toBe(1);
    expect(trBody.written).toBe(1);

    const res = await app.request("/log");
    expect(res.status).toBe(200);
    const log = await res.json();
    expect(log.length).toBeGreaterThanOrEqual(1);
    const last = log[0];
    expect(last.system).toMatch(/goal/i);
    const item = last.items.find((i: { key: string }) => i.key === "k");
    expect(item.source).toBe("Hi");
    expect(item.targetLocale).toBe("fr");
  });

  it("POST /translate leaves a reviewed value alone, but force=true overwrites it", async () => {
    const { app, file } = setupWithProvider();
    const headers = { "content-type": "application/json" };
    await app.request("/keys", { method: "POST", headers, body: JSON.stringify({ key: "k", value: "Hi" }) });
    await app.request("/keys/k/values/fr", { method: "PUT", headers, body: JSON.stringify({ value: "Hola" }) });

    const body = JSON.stringify({ onlyMissing: false, locales: ["fr"], keyGlob: "k" });
    expect((await (await app.request("/translate", { method: "POST", headers, body })).json()).written).toBe(0);

    const forced = JSON.stringify({ onlyMissing: false, locales: ["fr"], keyGlob: "k", force: true });
    expect((await (await app.request("/translate", { method: "POST", headers, body: forced })).json()).written).toBe(1);

    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k.values.fr).toMatchObject({ value: "Salut", state: "machine" });
  });

  it("returns an actionable message (not the raw SDK string) when the provider run fails to authenticate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    saveState(file, s);
    mkdirSync(join(dir, ".glotfile"), { recursive: true });
    writeFileSync(join(dir, ".glotfile", "settings.json"), JSON.stringify({ ai: { provider: "bedrock", model: "amazon.nova-pro-v1:0", endpoint: null, region: "eu-west-1", batchSize: 25 } }));
    const app = createApi({
      statePath: file,
      makeProvider: () => ({
        translate: async () => { throw new Error("Could not load credentials from any providers"); },
        supportsVision: () => true,
      }) as never,
    });
    const headers = { "content-type": "application/json" };
    await app.request("/keys", { method: "POST", headers, body: JSON.stringify({ key: "k", value: "Hi" }) });
    const res = await app.request("/translate", { method: "POST", headers, body: JSON.stringify({ onlyMissing: true }) });
    expect(res.ok).toBe(false);
    const body = await res.json();
    expect(body.error).toMatch(/AWS_PROFILE/);
    expect(body.error).not.toBe("Could not load credentials from any providers");
  });
});

describe("POST /ai-test (connection probe)", () => {
  const BEDROCK = { ai: { provider: "bedrock", model: "amazon.nova-pro-v1:0", endpoint: null, region: "eu-west-1", batchSize: 25 } };

  function setupAiTest(opts: { settings?: object; makeProvider?: () => unknown } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    saveState(file, s);
    if (opts.settings) {
      mkdirSync(join(dir, ".glotfile"), { recursive: true });
      writeFileSync(join(dir, ".glotfile", "settings.json"), JSON.stringify(opts.settings));
    }
    return { dir, file, app: createApi({ statePath: file, makeProvider: opts.makeProvider as never }) };
  }

  it("reports ok when the provider answers a probe translation", async () => {
    const { app } = setupAiTest({
      makeProvider: () => ({
        translate: async (reqs: { id: string }[]) => reqs.map((r) => ({ id: r.id, translation: "hola" })),
        supportsVision: () => true,
      }),
    });
    const res = await app.request("/ai-test", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns a friendly AWS_PROFILE message when bedrock can't load credentials", async () => {
    const { app } = setupAiTest({
      settings: BEDROCK,
      makeProvider: () => { throw new Error("Could not load credentials from any providers"); },
    });
    const res = await app.request("/ai-test", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/AWS_PROFILE/);
  });

  it("surfaces an IAM-permission error from the probe call clearly", async () => {
    const { app } = setupAiTest({
      settings: BEDROCK,
      makeProvider: () => ({
        translate: async () => { throw new Error("AccessDeniedException: User: arn:aws:iam::1:user/x is not authorized to perform: bedrock:InvokeModel"); },
        supportsVision: () => true,
      }),
    });
    const res = await app.request("/ai-test", { method: "POST" });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/bedrock:InvokeModel/);
  });
});

describe("POST /translate/estimate", () => {
  it("returns requests, batches, tokens and builtin pricing without translating", async () => {
    const { app, file } = setup();
    createKeyDirect(file);
    const res = await app.request("/translate/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // one key, one target locale (fr)
    expect(body.requests).toBe(1);
    expect(body.batches).toBe(1);
    expect(body.perLocale).toEqual([expect.objectContaining({ locale: "fr", requests: 1 })]);
    expect(body.inputTokens).toBeGreaterThan(0);
    // default local settings = anthropic haiku → builtin pricing
    expect(body.pricing).toMatchObject({ source: "builtin" });
    expect(body.estimatedCost).toBeGreaterThan(0);
    // estimating must not write translations
    expect(JSON.parse(readFileSync(file, "utf8")).keys["auth.in"].values.fr).toBeUndefined();
  });

  it("scopes by keys and locales like /translate/stream", async () => {
    const { app, file } = setup();
    createKeyDirect(file);
    const res = await app.request("/translate/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["no.such.key"], locales: ["fr"] }),
    });
    expect((await res.json()).requests).toBe(0);
  });
});

describe("POST /translate/stream (SSE progress stream)", () => {
  // Scope (keys/locales) is POSTed in the body — never the URL — so a large
  // filtered key set can't overflow Node's header limit (HTTP 431).
  const streamReq = (app: ReturnType<typeof createApi>, body: Record<string, unknown> = {}) =>
    app.request("/translate/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  function setupWithBatchProvider() {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    saveState(file, s);
    // The fake provider below fires onBatchComplete per item, so batching is driven
    // by the stub, not by any committed batchSize (AI config now lives in local settings).
    const makeProvider = () => ({
      translate: async (reqs: { id: string }[], onBatchComplete?: (done: number, total: number, results: { id: string; translation: string }[]) => void) => {
        const results: { id: string; translation: string }[] = [];
        // honour batchSize=1 so each item fires a separate onBatchComplete
        for (const req of reqs) {
          const batchResult = [{ id: req.id, translation: "Salut" }];
          results.push(...batchResult);
          onBatchComplete?.(results.length, reqs.length, batchResult);
        }
        return results;
      },
      supportsVision: () => true,
    });
    return { dir, file, app: createApi({ statePath: file, makeProvider }) };
  }

  async function collectSSE(res: Response): Promise<Array<{ event: string; data: unknown }>> {
    const text = await res.text();
    const events: Array<{ event: string; data: unknown }> = [];
    let currentEvent = "message";
    for (const line of text.split("\n")) {
      if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        events.push({ event: currentEvent, data: JSON.parse(line.slice(5).trim()) });
        currentEvent = "message";
      }
    }
    return events;
  }

  it("emits progress events per batch then a done event, and persists each batch to disk", async () => {
    const { app, file } = setupWithBatchProvider();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k1", value: "Hi" }),
    });
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k2", value: "Bye" }),
    });

    const res = await streamReq(app);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const events = await collectSSE(res);
    const progressEvents = events.filter((e) => e.event === "progress");
    const doneEvents = events.filter((e) => e.event === "done");

    // batchSize=1 → 2 progress events (one per batch)
    expect(progressEvents).toHaveLength(2);
    expect((progressEvents[0].data as { done: number; total: number }).total).toBe(2);
    expect((progressEvents[0].data as { done: number; total: number }).done).toBe(1);
    expect((progressEvents[1].data as { done: number; total: number }).done).toBe(2);

    expect(doneEvents).toHaveLength(1);
    expect((doneEvents[0].data as { written: number }).written).toBe(2);

    // each batch is persisted; both translations must be on disk
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k1.values.fr).toMatchObject({ value: "Salut" });
    expect(saved.keys.k2.values.fr).toMatchObject({ value: "Salut" });
  });

  it("emits start, locale-start, enriched progress, and locale-done around the run", async () => {
    const { app } = setupWithBatchProvider();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k1", value: "Hi" }),
    });
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k2", value: "Bye" }),
    });

    const events = await collectSSE(await streamReq(app));
    const order = events.map((e) => e.event);

    // start: the upfront plan — one target locale (fr) needing 2 strings.
    const start = events.find((e) => e.event === "start")!;
    expect(start.data).toMatchObject({ total: 2, locales: [{ locale: "fr", total: 2 }] });

    // locale-start announces fr before any of its progress lands.
    expect((events.find((e) => e.event === "locale-start")!.data as { locale: string }).locale).toBe("fr");
    expect(order.indexOf("locale-start")).toBeLessThan(order.indexOf("progress"));

    // progress carries the per-locale running count, not just the global one.
    const prog = events.filter((e) => e.event === "progress").map((e) => e.data as { locale: string; localeDone: number; localeTotal: number });
    expect(prog[0]).toMatchObject({ locale: "fr", localeDone: 1, localeTotal: 2 });
    expect(prog[1]).toMatchObject({ locale: "fr", localeDone: 2, localeTotal: 2 });

    // locale-done after the last progress, then the terminal done.
    expect((events.find((e) => e.event === "locale-done")!.data as { locale: string }).locale).toBe("fr");
    expect(order.lastIndexOf("locale-done")).toBeGreaterThan(order.lastIndexOf("progress"));
    expect(order.indexOf("done")).toBeGreaterThan(order.indexOf("locale-done"));
  });

  it("writes one log entry per batch so partial runs are recorded", async () => {
    const { app, dir } = setupWithBatchProvider();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k1", value: "Hi" }),
    });
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k2", value: "Bye" }),
    });

    // Drain the SSE stream to completion before reading disk — the Response
    // resolves on headers, but the per-batch log writes happen as the stream runs.
    await collectSSE(await streamReq(app));

    // batchSize=1, 2 keys → 2 batches → 2 translate entries (the log also holds
    // the two "key" entries from the POSTs above, so filter to AI translates).
    const logPath = join(dir, ".glotfile", "log.jsonl");
    const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => JSON.parse(l)).filter((e) => e.kind === "translate");
    expect(entries).toHaveLength(2);
    expect(entries[0].items).toHaveLength(1);
    expect(entries[1].items).toHaveLength(1);
    expect(entries[0].results).toHaveLength(1);
    expect(entries[1].results).toHaveLength(1);
  });

  it("emits a done event with written=0 when nothing needs translating", async () => {
    const { app } = setupWithBatchProvider();
    const res = await streamReq(app);
    expect(res.status).toBe(200);
    const events = await collectSSE(res);
    expect(events.filter((e) => e.event === "progress")).toHaveLength(0);
    const done = events.find((e) => e.event === "done");
    expect((done?.data as { written: number }).written).toBe(0);
  });

  it("logs [translate] progress and summary to stdout", async () => {
    const { app } = setupWithBatchProvider();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k1", value: "Hi" }),
    });
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k2", value: "Bye" }),
    });

    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => { logged.push(args.join(" ")); });
    try {
      const res = await streamReq(app);
      await collectSSE(res);
    } finally {
      spy.mockRestore();
    }

    // Should log a start line and a completion line
    expect(logged.some((l) => l.includes("[translate]") && l.includes("2"))).toBe(true);
    expect(logged.some((l) => l.includes("[translate]") && l.includes("wrote"))).toBe(true);
  });

  it("scopes the run to the keys + locales in the POST body", async () => {
    const { app, file } = setupWithBatchProvider();
    for (const key of ["k1", "k2"]) {
      await app.request("/keys", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value: "Hi" }),
      });
    }

    const res = await streamReq(app, { keys: ["k1"], locales: ["fr"] });
    const events = await collectSSE(res);
    const done = events.find((e) => e.event === "done");
    // Only k1@fr is in scope, so exactly one string is written.
    expect((done?.data as { written: number }).written).toBe(1);

    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k1.values.fr).toMatchObject({ value: "Salut" });
    expect(saved.keys.k2.values?.fr).toBeUndefined();
  });
});

describe("GET /export/preview", () => {
  it("returns files and warnings without writing to disk", async () => {
    const { app, file } = setup();
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
    const res = await app.request("/export/preview");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.files)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.files.length).toBeGreaterThan(0);
    for (const f of body.files) {
      expect(typeof f.path).toBe("string");
      expect(typeof f.contents).toBe("string");
      // the preview must NOT create the file on disk
      expect(existsSync(join(dirname(file), f.path))).toBe(false);
    }
  });
});

describe("note routes", () => {
  function setupKey() {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    saveState(file, defaultState());
    const app = createApi({ statePath: file });
    return { file, app };
  }

  async function makeKey(app: ReturnType<typeof createApi>) {
    await app.request("/keys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: "Hi" }),
    });
  }

  it("POST creates a note, returns it, and persists it", async () => {
    const { app, file } = setupKey();
    await makeKey(app);
    const res = await app.request("/keys/k/notes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Legal signed off" }),
    });
    expect(res.status).toBe(200);
    const note = await res.json();
    expect(note.text).toBe("Legal signed off");
    expect(note.id).toMatch(/^n_/);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k.notes[0].text).toBe("Legal signed off");
  });

  it("POST rejects blank text with 400", async () => {
    const { app } = setupKey();
    await makeKey(app);
    const res = await app.request("/keys/k/notes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT edits a note's text", async () => {
    const { app, file } = setupKey();
    await makeKey(app);
    const note = await (await app.request("/keys/k/notes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "old" }),
    })).json();
    const res = await app.request(`/keys/k/notes/${note.id}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "new" }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k.notes[0].text).toBe("new");
  });

  it("DELETE removes a note", async () => {
    const { app, file } = setupKey();
    await makeKey(app);
    const note = await (await app.request("/keys/k/notes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "bye" }),
    })).json();
    const res = await app.request(`/keys/k/notes/${note.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.k.notes).toEqual([]);
  });
});

describe("notes never reach the AI log", () => {
  it("a translated key's note text is absent from the AI log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "k", "Hi");
    addNote(s, "k", "SECRET-LOG-NOTE", () => "2026-06-04T10:00:00.000Z");
    saveState(file, s);
    const makeProvider = () => ({
      translate: async (reqs: { id: string }[]) => reqs.map((r) => ({ id: r.id, translation: "Salut" })),
      supportsVision: () => true,
    });
    const app = createApi({ statePath: file, makeProvider });

    await app.request("/translate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ onlyMissing: true }),
    });

    const log = await (await app.request("/log")).json();
    expect(JSON.stringify(log)).not.toContain("SECRET-LOG-NOTE");
  });
});

describe("api plurals", () => {
  const jsonHeaders = { "content-type": "application/json" };
  async function createPlural(app: ReturnType<typeof createApi>, key = "cart.items") {
    return app.request("/keys", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ key, value: "{count} items", plural: { arg: "count" } }) });
  }

  it("POST /keys with a plural marker seeds the source 'other' form", async () => {
    const { app, file } = setup();
    expect((await createPlural(app)).status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys["cart.items"].plural).toEqual({ arg: "count" });
    expect(saved.keys["cart.items"].values.en.forms).toEqual({ other: "{count} items" });
  });

  it("PUT /keys/:key/plural/:locale writes a target as reviewed", async () => {
    const { app, file } = setup();
    await createPlural(app);
    const res = await app.request("/keys/cart.items/plural/fr", {
      method: "PUT", headers: jsonHeaders,
      body: JSON.stringify({ forms: { one: "{count} article", other: "{count} articles" } }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys["cart.items"].values.fr).toMatchObject({ forms: { one: "{count} article", other: "{count} articles" }, state: "reviewed" });
  });

  it("PUT /keys/:key/plural/:locale on the source locale keeps state 'source'", async () => {
    const { app, file } = setup();
    await createPlural(app);
    const res = await app.request("/keys/cart.items/plural/en", {
      method: "PUT", headers: jsonHeaders,
      body: JSON.stringify({ forms: { one: "{count} item", other: "{count} items" } }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys["cart.items"].values.en.state).toBe("source");
    expect(saved.keys["cart.items"].values.en.forms.one).toBe("{count} item");
  });

  it("POST then DELETE /keys/:key/plural converts scalar <-> plural", async () => {
    const { app, file } = setup();
    await app.request("/keys", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ key: "items", value: "items" }) });
    expect((await app.request("/keys/items/plural", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ arg: "count" }) })).status).toBe(200);
    let saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys["items"].plural).toEqual({ arg: "count" });
    expect(saved.keys["items"].values.en.forms).toEqual({ other: "items" });
    expect((await app.request("/keys/items/plural", { method: "DELETE" })).status).toBe(200);
    saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys["items"].plural).toBeUndefined();
    expect(saved.keys["items"].values.en.value).toBe("items");
  });

  it("PUT /keys/:key/plural/:locale on a scalar key is a 400", async () => {
    const { app } = setup();
    await app.request("/keys", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ key: "items", value: "items" }) });
    const res = await app.request("/keys/items/plural/fr", { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ forms: { other: "x" } }) });
    expect(res.status).toBe(400);
  });

  describe("import", () => {
    function importFixtureProject() {
      const dir = mkdtempSync(join(tmpdir(), "glot-import-"));
      const file = join(dir, "glotfile.json");
      saveState(file, defaultState());
      // Symlink the fixture lang dir into the tmp dir so detect() finds it.
      symlinkSync(resolve("test/fixtures/import/laravel/lang"), join(dir, "lang"));
      return { dir, file, app: createApi({ statePath: file }) };
    }

    it("GET /import/detect returns found:false when no locale files exist", async () => {
      const { app } = setup();
      const res = await app.request("/import/detect");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.found).toBe(false);
    });

    it("GET /import/detect returns found:true for a laravel fixture root", async () => {
      const { app } = importFixtureProject();
      const res = await app.request("/import/detect");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.found).toBe(true);
      expect(body.format).toBe("laravel-php");
      expect(body.locales).toContain("en");
    });

    it("GET /import/detect enriches with keyCount and sampleKeys for the wizard", async () => {
      const { app } = importFixtureProject();
      const res = await app.request("/import/detect");
      const body = await res.json();
      expect(body.keyCount).toBe(2);
      expect(Array.isArray(body.sampleKeys)).toBe(true);
      expect(body.sampleKeys.length).toBeGreaterThan(0);
      // Samples carry the source-locale value (Laravel :name normalized to {name}).
      const welcome = body.sampleKeys.find((s: { key: string }) => s.key === "auth.welcome");
      expect(welcome?.value).toBe("Welcome {name}");
    });

    it("POST /import writes the imported state into an empty project", async () => {
      const { app, file } = importFixtureProject();
      const res = await app.request("/import", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ format: "laravel-php", sourceLocale: "en" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.keyCount).toBe(2);
      expect(body.localeCount).toBe(2);
      const saved = JSON.parse(readFileSync(file, "utf8"));
      expect(saved.keys["auth.welcome"].values.en.value).toBe("Welcome {name}");
      expect(saved.keys["auth.welcome"].values.en.state).toBe("source");
    });

    it("POST /import refuses when project already has keys", async () => {
      const { app, file } = setup();
      createKeyDirect(file);
      const res = await app.request("/import", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ format: "laravel-php", sourceLocale: "en" }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/non-empty/);
    });
  });
});

describe("POST /context/build", () => {
  function setupContext() {
    const dir = mkdtempSync(join(tmpdir(), "glot-ctx-api-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "welcome.title", "Welcome");
    saveState(file, s);
    return { dir, file };
  }

  async function collectSSE(res: Response) {
    const text = await res.text();
    const events: { event: string; data: unknown }[] = [];
    let currentEvent = "message";
    for (const line of text.split("\n")) {
      if (line.startsWith("event:")) { currentEvent = line.slice(6).trim(); continue; }
      if (line.startsWith("data:")) {
        events.push({ event: currentEvent, data: JSON.parse(line.slice(5).trim()) });
        currentEvent = "message";
      }
    }
    return events;
  }

  it("sends error event when no usage cache exists", async () => {
    const { file } = setupContext();
    const app = createApi({ statePath: file });
    const res = await app.request("/context/build", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const events = await collectSSE(res);
    const err = events.find((e) => e.event === "error");
    expect((err?.data as { error: string }).error).toMatch(/scan/i);
  });

  it("calls complete() and writes context to keys, emitting progress then done", async () => {
    const { dir, file } = setupContext();
    mkdirSync(join(dir, ".glotfile"), { recursive: true });
    writeFileSync(join(dir, ".glotfile", "usage.json"), JSON.stringify({
      version: 1, scannedAt: "2026-06-08T10:00:00.000Z", files: {},
    }));
    const makeProvider = () => ({
      translate: async () => [],
      supportsVision: () => false,
      complete: async () => ({ items: [{ id: "0", context: "The page header on the welcome screen." }] }),
    });
    const app = createApi({ statePath: file, makeProvider });
    const res = await app.request("/context/build", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    expect(res.status).toBe(200);
    const events = await collectSSE(res);
    expect(events.find((e) => e.event === "start")).toBeTruthy();
    expect(events.find((e) => e.event === "progress")).toBeTruthy();
    const done = events.find((e) => e.event === "done");
    expect((done?.data as { written: number }).written).toBe(1);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys["welcome.title"].context).toBe("The page header on the welcome screen.");
    expect(saved.keys["welcome.title"].contextSource).toBe("ai");
  });
});

describe("GET /scan/usage", () => {
  function setupWithCache(extra?: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "glot-usage-"));
    const file = join(dir, "glotfile.json");
    saveState(file, defaultState());
    saveUsageCache(dir, {
      version: 1,
      scannedAt: "2026-06-08T00:00:00.000Z",
      files: {
        "app/Foo.php": {
          mtime: 1, size: 1,
          refs: [{ key: "auth.login", line: 12, col: 5, scanner: "laravel" }],
          prefixes: [],
        },
        "app/Bar.php": {
          mtime: 1, size: 1,
          refs: [],
          prefixes: [{ prefix: "messages.", line: 7, col: 9, scanner: "laravel" }],
        },
      },
    });
    extra?.(dir);
    return { dir, app: createApi({ statePath: file }) };
  }

  it("returns exact refs with an absolute path", async () => {
    const { dir, app } = setupWithCache();
    const res = await app.request("/scan/usage?key=auth.login");
    const body = await res.json();
    expect(body.indexed).toBe(true);
    expect(body.refs).toHaveLength(1);
    expect(body.refs[0]).toMatchObject({ file: "app/Foo.php", line: 12, col: 5 });
    expect(body.refs[0].abs).toBe(resolve(dir, "app/Foo.php"));
  });

  it("reports the project name (basename of the project root)", async () => {
    const { dir, app } = setupWithCache();
    const res = await app.request("/scan/usage?key=auth.login");
    const body = await res.json();
    expect(body.project).toBe(basename(dir));
  });

  it("prefers .idea/.name for the project name when present", async () => {
    const { app } = setupWithCache((dir) => {
      mkdirSync(join(dir, ".idea"), { recursive: true });
      writeFileSync(join(dir, ".idea", ".name"), "MyProject\n");
    });
    const res = await app.request("/scan/usage?key=auth.login");
    const body = await res.json();
    expect(body.project).toBe("MyProject");
  });

  it("returns prefix matches as prefixRefs when the key starts with a recorded prefix", async () => {
    const { dir, app } = setupWithCache();
    const res = await app.request("/scan/usage?key=messages.welcome");
    const body = await res.json();
    expect(body.refs).toHaveLength(0);
    expect(body.prefixRefs).toHaveLength(1);
    expect(body.prefixRefs[0]).toMatchObject({ file: "app/Bar.php", line: 7, prefix: "messages." });
    expect(body.prefixRefs[0].abs).toBe(resolve(dir, "app/Bar.php"));
  });

  it("does not return a prefix match when the key is outside the prefix", async () => {
    const { app } = setupWithCache();
    const res = await app.request("/scan/usage?key=auth.login");
    const body = await res.json();
    expect(body.prefixRefs).toHaveLength(0);
  });
});

describe("GET /scan/used", () => {
  function setupUsed() {
    const dir = mkdtempSync(join(tmpdir(), "glot-used-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    createKey(s, "auth.login", "Sign in");      // exact ref
    createKey(s, "messages.welcome", "Welcome"); // prefix match
    createKey(s, "dead.key", "Nobody");          // unused
    saveState(file, s);
    saveUsageCache(dir, {
      version: 1,
      scannedAt: "2026-06-08T00:00:00.000Z",
      files: {
        "app/Foo.php": { mtime: 1, size: 1, refs: [{ key: "auth.login", line: 1, col: 1, scanner: "laravel" }], prefixes: [] },
        "app/Bar.php": { mtime: 1, size: 1, refs: [], prefixes: [{ prefix: "messages.", line: 1, col: 1, scanner: "laravel" }] },
      },
    });
    return { app: createApi({ statePath: file }) };
  }

  it("returns the used keys when an index exists", async () => {
    const { app } = setupUsed();
    const res = await app.request("/scan/used");
    const body = await res.json();
    expect(body.indexed).toBe(true);
    expect(body.used).toEqual(["auth.login", "messages.welcome"]);
    expect(body.scannedAt).toBe("2026-06-08T00:00:00.000Z");
  });

  it("reports not indexed when no scan cache exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-noused-"));
    const file = join(dir, "glotfile.json");
    saveState(file, defaultState());
    const app = createApi({ statePath: file });
    const res = await app.request("/scan/used");
    const body = await res.json();
    expect(body.indexed).toBe(false);
    expect(body.used).toEqual([]);
  });
});

describe("POST /keys/bulk-delete", () => {
  it("deletes the given keys and returns the removed list; unknown keys are skipped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-bulk-delete-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "a", "Hi");
    createKey(s, "b", "Bye");
    createKey(s, "c", "Yo");
    saveState(file, s);
    const app = createApi({ statePath: file });

    const res = await app.request("/keys/bulk-delete", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["a", "c", "ghost"] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).removed.sort()).toEqual(["a", "c"]);

    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.a).toBeUndefined();
    expect(saved.keys.c).toBeUndefined();
    expect(saved.keys.b.values.en.value).toBe("Bye");
  });

  it("returns 400 for an empty keys array", async () => {
    const { app } = setup();
    const res = await app.request("/keys/bulk-delete", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /keys/bulk-clear", () => {
  it("clears target values for the given keys and locales, keeping the source", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-bulk-clear-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr", "de"];
    createKey(s, "a", "Hi");
    createKey(s, "b", "Bye");
    s.keys.a!.values.fr = { value: "Salut", state: "reviewed" };
    s.keys.a!.values.de = { value: "Hallo", state: "reviewed" };
    s.keys.b!.values.fr = { value: "Au revoir", state: "reviewed" };
    saveState(file, s);
    const app = createApi({ statePath: file });

    const res = await app.request("/keys/bulk-clear", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["a", "b"], locales: ["fr"] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).cleared).toBe(2);

    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.a.values.fr).toBeUndefined();
    expect(saved.keys.b.values.fr).toBeUndefined();
    expect(saved.keys.a.values.de.value).toBe("Hallo"); // out-of-scope locale untouched
    expect(saved.keys.a.values.en.value).toBe("Hi"); // source kept
  });

  it("never clears the source locale even if asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-bulk-clear-src-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "a", "Hi");
    saveState(file, s);
    const app = createApi({ statePath: file });

    const res = await app.request("/keys/bulk-clear", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["a"], locales: ["en"] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).cleared).toBe(0);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.a.values.en.value).toBe("Hi");
  });

  it("returns 400 for an unknown locale", async () => {
    const { app } = setup();
    const res = await app.request("/keys/bulk-clear", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["x"], locales: ["zz"] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /keys/bulk-meta", () => {
  it("adds and removes tags as a set union/difference", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-bulk-meta-tags-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "a", "Hi");
    s.keys.a!.tags = ["old"];
    createKey(s, "b", "Bye");
    saveState(file, s);
    const app = createApi({ statePath: file });

    const res = await app.request("/keys/bulk-meta", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["a", "b"], addTags: ["nav"], removeTags: ["old"] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);

    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.a.tags).toEqual(["nav"]); // "old" removed, "nav" added
    expect(saved.keys.b.tags).toEqual(["nav"]);
  });

  it("sets skipTranslate true, and deletes the field when set false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-bulk-meta-skip-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "a", "Hi");
    saveState(file, s);
    const app = createApi({ statePath: file });

    await app.request("/keys/bulk-meta", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["a"], skipTranslate: true }),
    });
    expect(JSON.parse(readFileSync(file, "utf8")).keys.a.skipTranslate).toBe(true);

    await app.request("/keys/bulk-meta", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["a"], skipTranslate: false }),
    });
    expect(JSON.parse(readFileSync(file, "utf8")).keys.a.skipTranslate).toBeUndefined();
  });
});

describe("POST /keys/bulk-state", () => {
  it("sets the state only on locales that have a value, skipping source and missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-bulk-state-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr", "de"];
    createKey(s, "a", "Hi");
    s.keys.a!.values.fr = { value: "Salut", state: "machine" };
    // de intentionally has no value → must be skipped
    saveState(file, s);
    const app = createApi({ statePath: file });

    const res = await app.request("/keys/bulk-state", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["a"], locales: ["fr", "de"], state: "reviewed" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);

    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.keys.a.values.fr.state).toBe("reviewed");
    expect(saved.keys.a.values.de).toBeUndefined();
    expect(saved.keys.a.values.en.state).toBe("source"); // source untouched
  });

  it("returns 400 for an invalid state value", async () => {
    const { app } = setup();
    const res = await app.request("/keys/bulk-state", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["a"], locales: ["fr"], state: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown locale", async () => {
    const { app } = setup();
    const res = await app.request("/keys/bulk-state", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["a"], locales: ["zz"], state: "reviewed" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /keys/:key/values/:locale/state", () => {
  it("rejects an invalid state without corrupting the file (must still load)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glot-set-state-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "a", "Hi");
    s.keys.a!.values.fr = { value: "Salut", state: "machine" };
    saveState(file, s);
    const app = createApi({ statePath: file });

    const res = await app.request("/keys/a/values/fr/state", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "frozen" }),
    });
    expect(res.status).toBe(400);
    // The catalog must still load — a persisted bogus state would make this throw.
    expect((await app.request("/state")).status).toBe(200);
  });
});

describe("local settings (AI + editor)", () => {
  function setupLocal() {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    saveState(file, s);
    return { dir, file, app: createApi({ statePath: file }) };
  }
  const headers = { "content-type": "application/json" };

  it("GET /local-settings returns defaults when nothing is stored", async () => {
    const { app } = setupLocal();
    const body = await (await app.request("/local-settings")).json();
    expect(body.ai.provider).toBe("anthropic");
    expect(body.editor).toBe("vscode");
  });

  it("PUT persists ai + editor to .glotfile/settings.json (with a self-ignoring .gitignore)", async () => {
    const { dir, app } = setupLocal();
    const res = await app.request("/local-settings", {
      method: "PUT", headers,
      body: JSON.stringify({ ai: { provider: "openai", model: "gpt-4o-mini", endpoint: null, region: null, batchSize: 8 }, editor: "zed" }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(join(dir, ".glotfile", "settings.json"), "utf8"));
    expect(saved.ai.provider).toBe("openai");
    expect(saved.editor).toBe("zed");
    expect(readFileSync(join(dir, ".glotfile", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("PUT rejects an unknown provider and an unknown editor", async () => {
    const { app } = setupLocal();
    const badAi = await app.request("/local-settings", {
      method: "PUT", headers, body: JSON.stringify({ ai: { provider: "cohere", model: "m", endpoint: null, batchSize: 25 } }),
    });
    expect(badAi.status).toBe(400);
    const badEditor = await app.request("/local-settings", {
      method: "PUT", headers, body: JSON.stringify({ editor: "emacs" }),
    });
    expect(badEditor.status).toBe(400);
  });

  it("PUT editor-only leaves a previously-saved ai block untouched", async () => {
    const { app } = setupLocal();
    await app.request("/local-settings", { method: "PUT", headers, body: JSON.stringify({ ai: { provider: "openrouter", model: "x", endpoint: null, region: null, batchSize: 3 } }) });
    await app.request("/local-settings", { method: "PUT", headers, body: JSON.stringify({ editor: "phpstorm" }) });
    const body = await (await app.request("/local-settings")).json();
    expect(body.ai.provider).toBe("openrouter");
    expect(body.editor).toBe("phpstorm");
  });

  it("PUT /config no longer writes an ai block into the committed config", async () => {
    const { file, app } = setupLocal();
    const res = await app.request("/config", {
      method: "PUT", headers,
      body: JSON.stringify({ sourceLocale: "en", locales: ["en"], outputs: [], format: { indent: 2, sortKeys: true, finalNewline: true } }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.config).not.toHaveProperty("ai");
  });
});

describe("AI profiles", () => {
  function setupLocal() {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    saveState(file, s);
    return { dir, file, app: createApi({ statePath: file }) };
  }
  const headers = { "content-type": "application/json" };
  const validAi = { provider: "openai", model: "gpt-4o-mini", endpoint: null, region: null, batchSize: 5 };

  it("GET /ai-profiles returns empty profiles and null activeProfile by default", async () => {
    const { app } = setupLocal();
    const body = await (await app.request("/ai-profiles")).json();
    expect(body.profiles).toEqual({});
    expect(body.activeProfile).toBeNull();
  });

  it("PUT /ai-profiles/:name creates a profile", async () => {
    const { app } = setupLocal();
    const res = await app.request("/ai-profiles/fast", {
      method: "PUT", headers, body: JSON.stringify(validAi),
    });
    expect(res.status).toBe(200);
    const { ok } = await res.json();
    expect(ok).toBe(true);
    const list = await (await app.request("/ai-profiles")).json();
    expect(list.profiles.fast).toMatchObject(validAi);
  });

  it("PUT /ai-profiles/:name updates an existing profile", async () => {
    const { app } = setupLocal();
    await app.request("/ai-profiles/fast", { method: "PUT", headers, body: JSON.stringify(validAi) });
    const updated = { ...validAi, model: "gpt-4o" };
    await app.request("/ai-profiles/fast", { method: "PUT", headers, body: JSON.stringify(updated) });
    const list = await (await app.request("/ai-profiles")).json();
    expect(list.profiles.fast.model).toBe("gpt-4o");
  });

  it("DELETE /ai-profiles/:name removes a profile", async () => {
    const { app } = setupLocal();
    await app.request("/ai-profiles/fast", { method: "PUT", headers, body: JSON.stringify(validAi) });
    const res = await app.request("/ai-profiles/fast", { method: "DELETE" });
    expect(res.status).toBe(200);
    const list = await (await app.request("/ai-profiles")).json();
    expect(list.profiles).not.toHaveProperty("fast");
  });

  it("DELETE /ai-profiles/:name clears activeProfile when it was the active profile", async () => {
    const { app } = setupLocal();
    await app.request("/ai-profiles/fast", { method: "PUT", headers, body: JSON.stringify(validAi) });
    await app.request("/ai-profiles/active", { method: "POST", headers, body: JSON.stringify({ name: "fast" }) });
    await app.request("/ai-profiles/fast", { method: "DELETE" });
    const list = await (await app.request("/ai-profiles")).json();
    expect(list.activeProfile).toBeNull();
  });

  it("POST /ai-profiles/active sets the active profile", async () => {
    const { app } = setupLocal();
    await app.request("/ai-profiles/fast", { method: "PUT", headers, body: JSON.stringify(validAi) });
    const res = await app.request("/ai-profiles/active", { method: "POST", headers, body: JSON.stringify({ name: "fast" }) });
    expect(res.status).toBe(200);
    const list = await (await app.request("/ai-profiles")).json();
    expect(list.activeProfile).toBe("fast");
  });

  it("POST /ai-profiles/active with null clears the active profile", async () => {
    const { app } = setupLocal();
    await app.request("/ai-profiles/fast", { method: "PUT", headers, body: JSON.stringify(validAi) });
    await app.request("/ai-profiles/active", { method: "POST", headers, body: JSON.stringify({ name: "fast" }) });
    const res = await app.request("/ai-profiles/active", { method: "POST", headers, body: JSON.stringify({ name: null }) });
    expect(res.status).toBe(200);
    const list = await (await app.request("/ai-profiles")).json();
    expect(list.activeProfile).toBeNull();
  });

  it("GET /local-settings returns ai from the active profile when one is set", async () => {
    const { app } = setupLocal();
    const profileAi = { provider: "openai", model: "gpt-4o", endpoint: null, region: null, batchSize: 10 };
    await app.request("/ai-profiles/work", { method: "PUT", headers, body: JSON.stringify(profileAi) });
    await app.request("/ai-profiles/active", { method: "POST", headers, body: JSON.stringify({ name: "work" }) });
    const body = await (await app.request("/local-settings")).json();
    expect(body.ai.provider).toBe("openai");
    expect(body.ai.model).toBe("gpt-4o");
  });
});

describe("suppression routes", () => {
  function setupIdentical() {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "ui.logo", "Logo");
    s.keys["ui.logo"]!.values.fr = { value: "Logo", state: "reviewed" };
    saveState(file, s);
    return { file, app: createApi({ statePath: file }) };
  }

  it("POST /keys/:key/suppressions hides the finding from GET /lint", async () => {
    const { app, file } = setupIdentical();
    let lint = await (await app.request("/lint")).json();
    expect(lint.findings.some((f: any) => f.ruleId === "identical-to-source")).toBe(true);

    const res = await app.request("/keys/ui.logo/suppressions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule: "identical-to-source", locale: "fr" }),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(file, "utf8")).toContain('"suppressions"');

    lint = await (await app.request("/lint")).json();
    expect(lint.findings.some((f: any) => f.ruleId === "identical-to-source")).toBe(false);
    expect(lint.counts.suppressed).toBe(1);

    const withSuppressed = await (await app.request("/lint?includeSuppressed=1")).json();
    const f = withSuppressed.findings.find((x: any) => x.ruleId === "identical-to-source");
    expect(f?.suppressed).toBe(true);
  });

  it("DELETE /keys/:key/suppressions restores the finding", async () => {
    const { app } = setupIdentical();
    await app.request("/keys/ui.logo/suppressions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule: "identical-to-source", locale: "fr" }),
    });
    const res = await app.request("/keys/ui.logo/suppressions?rule=identical-to-source&locale=fr", { method: "DELETE" });
    expect(res.status).toBe(200);
    const lint = await (await app.request("/lint")).json();
    expect(lint.findings.some((f: any) => f.ruleId === "identical-to-source")).toBe(true);
  });

  it("POST /lint/accept bulk-suppresses matching warnings", async () => {
    const { app } = setupIdentical();
    const res = await app.request("/lint/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules: ["identical-to-source"] }),
    });
    const body = await res.json();
    expect(body.accepted).toBe(1);
    const lint = await (await app.request("/lint")).json();
    expect(lint.findings.some((f: any) => f.ruleId === "identical-to-source")).toBe(false);
  });

  it("rejects an unknown rule id", async () => {
    const { app } = setupIdentical();
    const res = await app.request("/keys/ui.logo/suppressions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule: "bogus", locale: "fr" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("batch translation endpoints", () => {
  // Each test gets its own temp dir so batch.json state doesn't bleed between tests.
  function setupBatch(batchCapable: boolean) {
    const dir = mkdtempSync(join(tmpdir(), "glot-batch-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "a", "Hi");
    saveState(file, s);

    if (!batchCapable) {
      // Non-batch provider: only translate + supportsVision.
      const makeProvider = () => ({
        translate: async (reqs: { id: string }[]) => reqs.map((r) => ({ id: r.id, translation: "Salut" })),
        supportsVision: () => false,
      });
      return { dir, file, app: createApi({ statePath: file, makeProvider }) };
    }

    // Batch-capable provider: captures submitted jobs so translationBatchResults
    // can reconstruct per-item translations from them.
    let capturedJobs: Array<{ customId: string; locale: string; requests: Array<{ id: string }> }> = [];
    const makeProvider = () => ({
      translate: async (reqs: { id: string }[]) => reqs.map((r) => ({ id: r.id, translation: "Salut" })),
      supportsVision: () => false,
      complete: async () => ({}),
      submitTranslationBatch: async (jobs: Array<{ customId: string; locale: string; requests: Array<{ id: string }> }>) => {
        capturedJobs = jobs;
        return "msgbatch_x";
      },
      translationBatchStatus: async (_batchId: string) => ({
        status: "ended" as const,
        counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 },
      }),
      translationBatchResults: async (_batchId: string) => {
        const map = new Map<string, { type: "items"; items: Array<{ id: string; translation: string }> }>();
        for (const job of capturedJobs) {
          map.set(job.customId, {
            type: "items",
            items: job.requests.map((r) => ({ id: r.id, translation: "Salut" })),
          });
        }
        return map;
      },
      cancelTranslationBatch: async (_batchId: string) => { /* no-op */ },
    });
    return { dir, file, app: createApi({ statePath: file, makeProvider }) };
  }

  it("GET /batch/status with a non-batch provider returns supported:false and pending:null", async () => {
    const { app } = setupBatch(false);
    const res = await app.request("/batch/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.supported).toBe(false);
    expect(body.pending).toBeNull();
  });

  it("POST /batch/translate submits, returns batchId + total; GET /batch/status shows pending", async () => {
    const { app } = setupBatch(true);
    const res = await app.request("/batch/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batchId).toBe("msgbatch_x");
    expect(body.total).toBeGreaterThan(0);

    const status = await (await app.request("/batch/status")).json();
    expect(status.supported).toBe(true);
    expect(status.pending).not.toBeNull();
    expect(status.pending.batchId).toBe("msgbatch_x");
    expect(status.pending.status).toBe("ended");
    expect(status.pending.counts).toMatchObject({ succeeded: 1 });
  });

  it("POST /batch/apply applies results, returns written > 0; status then shows pending:null", async () => {
    const { app } = setupBatch(true);
    // Submit first.
    await app.request("/batch/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await app.request("/batch/apply", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.written).toBeGreaterThan(0);

    // Pending must be cleared after apply.
    const status = await (await app.request("/batch/status")).json();
    expect(status.pending).toBeNull();
  });

  it("POST /batch/cancel after a submit returns 200 and status shows pending:null", async () => {
    const { app } = setupBatch(true);
    await app.request("/batch/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await app.request("/batch/cancel", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canceled).toBe("msgbatch_x");

    const status = await (await app.request("/batch/status")).json();
    expect(status.pending).toBeNull();
  });

  it("POST /batch/apply with nothing pending returns 404", async () => {
    const { app } = setupBatch(true);
    const res = await app.request("/batch/apply", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /batch/translate while one is pending returns 409", async () => {
    const { app } = setupBatch(true);
    await app.request("/batch/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    // Second submit should conflict.
    const res = await app.request("/batch/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });

  describe("POST /sync", () => {
    function angularXlf(units: { id: string; source: string }[]): string {
      const body = units
        .map((u) => `      <trans-unit id="${u.id}" datatype="html"><source>${u.source}</source></trans-unit>`)
        .join("\n");
      return (
        `<?xml version="1.0" encoding="UTF-8" ?>\n` +
        `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n` +
        `  <file source-language="en" datatype="plaintext" original="ng2.template">\n` +
        `    <body>\n${body}\n    </body>\n  </file>\n</xliff>\n`
      );
    }

    async function setupSync() {
      const { runImport } = await import("./import/run.js");
      const dir = mkdtempSync(join(tmpdir(), "glot-apisync-"));
      const file = join(dir, "glotfile.json");
      writeFileSync(join(dir, "messages.xlf"), angularXlf([
        { id: "keep", source: "Keep" },
        { id: "remove", source: "Old" },
      ]));
      saveState(file, runImport({ projectRoot: dir }).state);
      // Re-extract: add a key, drop one.
      writeFileSync(join(dir, "messages.xlf"), angularXlf([
        { id: "keep", source: "Keep" },
        { id: "added", source: "New" },
      ]));
      return { dir, file, app: createApi({ statePath: file }) };
    }

    const post = (app: ReturnType<typeof createApi>, b: object) =>
      app.request("/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

    it("returns the plan without writing when apply is not set", async () => {
      const { file, app } = await setupSync();
      const before = readFileSync(file, "utf8");
      const res = await post(app, {});
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.plan.added).toEqual(["added"]);
      expect(json.plan.removed).toEqual(["remove"]);
      expect(json.applied).toBeUndefined();
      expect(readFileSync(file, "utf8")).toBe(before);
    });

    it("applies and rebuilds the Angular usage index when apply:true", async () => {
      const { dir, file, app } = await setupSync();
      const res = await post(app, { apply: true });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.applied).toBe(true);
      const saved = JSON.parse(readFileSync(file, "utf8"));
      expect(saved.keys.added).toBeDefined();
      expect(saved.keys.remove).toBeDefined(); // kept without prune
      expect(existsSync(join(dir, ".glotfile", "usage.json"))).toBe(true);
    });

    it("prunes removed keys when prune:true", async () => {
      const { file, app } = await setupSync();
      await post(app, { apply: true, prune: true });
      const saved = JSON.parse(readFileSync(file, "utf8"));
      expect(saved.keys.remove).toBeUndefined();
    });
  });
});

describe("GET /events (live-reload SSE)", () => {
  function setupWatched(opts: { watch?: boolean; intervalMs?: number } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "glot-"));
    const file = join(dir, "glotfile.json");
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    saveState(file, s);
    const hub = createEventHub();
    let watcher: StateWatcher | undefined;
    const app = createApi({
      statePath: file,
      eventHub: hub,
      watch: opts.watch,
      watchIntervalMs: opts.intervalMs,
      onWatcher: (w) => { watcher = w; },
    });
    return { dir, file, hub, app, stop: () => watcher?.stop() };
  }

  // Reads the SSE body in the background into a growing buffer. The endpoint never
  // closes on its own, so callers cancel the reader when they're done.
  function pump(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const done = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
        }
      } catch { /* cancelled */ }
    })();
    return { get: () => buf, cancel: () => reader.cancel().catch(() => {}), done };
  }

  it("opens a text/event-stream that delivers a broadcast to the client", async () => {
    const { app, hub, stop } = setupWatched();
    const res = await app.request("/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const stream = pump(res);
    // Don't broadcast until the handler has actually subscribed, or the event races
    // ahead of the listener and is lost.
    await vi.waitFor(() => expect(hub.size()).toBe(1));
    hub.broadcast("state-changed", JSON.stringify({ at: "now" }));

    await vi.waitFor(() => expect(stream.get()).toContain("event: state-changed"));
    await stream.cancel();
    stop();
  });

  it("broadcasts state-changed when an external writer changes the file on disk", async () => {
    const { app, file, hub, stop } = setupWatched({ watch: true, intervalMs: 10 });
    const res = await app.request("/events");
    const stream = pump(res);
    await vi.waitFor(() => expect(hub.size()).toBe(1));

    // A CLI command / git restore rewrites the file behind the server's back.
    const s2 = defaultState();
    s2.config.locales = ["en", "fr"];
    createKey(s2, "x.y", "Hi");
    saveState(file, s2);

    await vi.waitFor(() => expect(stream.get()).toContain("event: state-changed"), { timeout: 2000 });
    await stream.cancel();
    stop();
  });

  it("does NOT broadcast for the server's own edits via the API", async () => {
    const { app, file, hub, stop } = setupWatched({ watch: true, intervalMs: 10 });
    const res = await app.request("/events");
    const stream = pump(res);
    await vi.waitFor(() => expect(hub.size()).toBe(1));

    // An edit made through the API (persist → noteWrite) must stay silent.
    await app.request("/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "self.edit", value: "Mine" }),
    });

    // Give the poll loop several cycles to (not) react.
    await new Promise((r) => setTimeout(r, 80));
    expect(stream.get()).not.toContain("event: state-changed");
    await stream.cancel();
    stop();

    // Sanity: the edit really did land on disk.
    expect(readFileSync(file, "utf8")).toContain("self.edit");
  });

  it("unsubscribes the client when the connection is closed", async () => {
    const { app, hub, stop } = setupWatched();
    const res = await app.request("/events");
    const stream = pump(res);
    await vi.waitFor(() => expect(hub.size()).toBe(1));

    await stream.cancel();
    await vi.waitFor(() => expect(hub.size()).toBe(0));
    stop();
  });

  it("GET /prices reports cache status and resolves a price", async () => {
    const { app } = setup();
    const cachePath = join(mkdtempSync(join(tmpdir(), "glot-prices-")), "model-prices.json");
    writeFileSync(cachePath, JSON.stringify({
      source: "models.dev",
      fetchedAt: "2026-06-16T00:00:00.000Z",
      models: { "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 } },
    }));
    vi.stubEnv("GLOTFILE_PRICES_PATH", cachePath);
    try {
      const res = await app.request("/prices");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.source).toBe("models.dev");
      expect(body.modelCount).toBe(1);
      expect(body.path).toBe(cachePath);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("POST /prices/refresh fetches, writes the cache, and reports the count", async () => {
    const { app } = setup();
    const cachePath = join(mkdtempSync(join(tmpdir(), "glot-prices-")), "model-prices.json");
    vi.stubEnv("GLOTFILE_PRICES_PATH", cachePath);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ anthropic: { models: { "anthropic/claude-haiku-4-5": { cost: { input: 1, output: 5 } } } } }),
    })));
    try {
      const res = await app.request("/prices/refresh", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.modelCount).toBe(1);
      expect(existsSync(cachePath)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("POST /prices/refresh returns 502 when the source is unreachable", async () => {
    const { app } = setup();
    const cachePath = join(mkdtempSync(join(tmpdir(), "glot-prices-")), "model-prices.json");
    vi.stubEnv("GLOTFILE_PRICES_PATH", cachePath);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    try {
      const res = await app.request("/prices/refresh", { method: "POST" });
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toMatch(/503/);
      expect(existsSync(cachePath)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("GET /prices/list returns the cached models sorted by id", async () => {
    const { app } = setup();
    const cachePath = join(mkdtempSync(join(tmpdir(), "glot-prices-")), "model-prices.json");
    writeFileSync(cachePath, JSON.stringify({
      source: "models.dev",
      fetchedAt: "2026-06-16T00:00:00.000Z",
      models: {
        "gpt-5.4": { inputPerMTok: 2.5, outputPerMTok: 15 },
        "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
      },
    }));
    vi.stubEnv("GLOTFILE_PRICES_PATH", cachePath);
    try {
      const res = await app.request("/prices/list");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.models.map((m: { id: string }) => m.id)).toEqual(["claude-haiku-4-5", "gpt-5.4"]);
      expect(body.models[0]).toMatchObject({ id: "claude-haiku-4-5", inputPerMTok: 1, outputPerMTok: 5 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("GET /prices/list returns an empty list when no cache exists", async () => {
    const { app } = setup();
    const missing = join(mkdtempSync(join(tmpdir(), "glot-prices-")), "absent.json");
    vi.stubEnv("GLOTFILE_PRICES_PATH", missing);
    try {
      const res = await app.request("/prices/list");
      expect(res.status).toBe(200);
      expect((await res.json()).models).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
