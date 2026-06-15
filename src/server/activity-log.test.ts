import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "./api.js";
import { saveState } from "./state.js";
import { defaultState } from "./schema.js";
import type { LogEntry } from "./log.js";

type Api = ReturnType<typeof createApi>;

function setup(): Api {
  const dir = mkdtempSync(join(tmpdir(), "glot-activity-"));
  const file = join(dir, "glotfile.json");
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  saveState(file, s);
  return createApi({ statePath: file });
}

const post = (app: Api, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const put = (app: Api, path: string, body: unknown) =>
  app.request(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const del = (app: Api, path: string) => app.request(path, { method: "DELETE" });
const latest = async (app: Api): Promise<LogEntry> => ((await (await app.request("/log")).json()) as LogEntry[])[0]!;

describe("activity log", () => {
  it("records key creation", async () => {
    const app = setup();
    await post(app, "/keys", { key: "auth.title", value: "Sign in" });
    const e = await latest(app);
    expect(e.kind).toBe("key");
    expect(e.summary).toBe("Created key auth.title");
    expect(e.after).toBe("Sign in");
  });

  it("records a translation edit with before and after", async () => {
    const app = setup();
    await post(app, "/keys", { key: "auth.title", value: "Sign in" });
    await put(app, "/keys/auth.title/values/fr", { value: "Connexion" });
    await put(app, "/keys/auth.title/values/fr", { value: "Se connecter" });
    const e = await latest(app);
    expect(e.kind).toBe("translation");
    expect(e.key).toBe("auth.title");
    expect(e.locale).toBe("fr");
    expect(e.before).toBe("Connexion");
    expect(e.after).toBe("Se connecter");
  });

  it("records a review-state change with before/after", async () => {
    const app = setup();
    await post(app, "/keys", { key: "auth.title", value: "Sign in" });
    await put(app, "/keys/auth.title/values/fr", { value: "Connexion" });
    await put(app, "/keys/auth.title/values/fr/state", { state: "needs-review" });
    const e = await latest(app);
    expect(e.kind).toBe("translation");
    expect(e.before).toBe("reviewed");
    expect(e.after).toBe("needs-review");
  });

  it("records a plural-forms edit with before and after", async () => {
    const app = setup();
    await post(app, "/keys", { key: "cart.items", value: "{count} items", plural: { arg: "count" } });
    await put(app, "/keys/cart.items/plural/fr", { forms: { one: "1 article", other: "{count} articles" } });
    await put(app, "/keys/cart.items/plural/fr", { forms: { one: "un article", other: "{count} articles" } });
    const e = await latest(app);
    expect(e.kind).toBe("translation");
    expect(e.locale).toBe("fr");
    expect(e.before).toEqual({ one: "1 article", other: "{count} articles" });
    expect(e.after).toEqual({ one: "un article", other: "{count} articles" });
  });

  it("records key deletion with the prior source value", async () => {
    const app = setup();
    await post(app, "/keys", { key: "auth.title", value: "Sign in" });
    await del(app, "/keys/auth.title");
    const e = await latest(app);
    expect(e.kind).toBe("key");
    expect(e.summary).toBe("Deleted key auth.title");
    expect(e.before).toBe("Sign in");
  });

  it("records a config save with before/after headline fields", async () => {
    const app = setup();
    const state = await (await app.request("/state")).json();
    await put(app, "/config", { ...state.config, locales: ["en", "fr", "de"] });
    const e = await latest(app);
    expect(e.kind).toBe("config");
    expect((e.after as { locales: string[] }).locales).toContain("de");
    expect((e.before as { locales: string[] }).locales).not.toContain("de");
  });

  it("records a glossary upsert and a dictionary addition", async () => {
    const app = setup();
    await put(app, "/glossary", { term: "Sign in" });
    const g = await latest(app);
    expect(g.kind).toBe("glossary");
    expect(g.summary).toContain("Sign in");

    await post(app, "/dictionary", { word: "glotfile" });
    const d = await latest(app);
    expect(d.kind).toBe("dictionary");
    expect(d.after).toBe("glotfile");
  });
});
