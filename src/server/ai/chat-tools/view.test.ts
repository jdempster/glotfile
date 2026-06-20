import { describe, it, expect, beforeEach } from "vitest";
import { viewTools } from "./view.js";
import { defaultState, type State } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

const tool = (name: string): ChatTool => {
  const t = viewTools.find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

interface ViewResult {
  ok: true;
  matched: number;
  total: number;
  sample: string[];
  viewFilter: Record<string, unknown>;
}

let state: State;
let ctx: ToolContext;
beforeEach(() => {
  state = defaultState();
  state.config.sourceLocale = "en";
  state.config.locales = ["en", "de", "fr"];
  state.keys = {
    // missing in fr (blank value)
    "plant.water": { values: { en: { value: "Water your plant", state: "source" }, de: { value: "Gieß deine Pflanze", state: "machine" }, fr: { value: "", state: "machine" } } },
    // missing in fr (no record at all)
    "plant.feed": { values: { en: { value: "Feed", state: "source" }, de: { value: "Düngen", state: "reviewed" } } },
    // complete
    "plant.light": { values: { en: { value: "Light", state: "source" }, de: { value: "Licht", state: "machine" }, fr: { value: "Lumière", state: "reviewed" } } },
    // tagged, complete
    "ui.save": { tags: ["ui"], values: { en: { value: "Save", state: "source" }, de: { value: "Speichern", state: "machine" }, fr: { value: "Enregistrer", state: "machine" } } },
  };
  ctx = { projectRoot: "/x", statePath: "", load: () => state, persist: (s) => { state = s; }, provider: null as never };
});

const run = (input: unknown) => tool("filter_view").run(input, ctx) as Promise<ViewResult>;

describe("filter_view tool", () => {
  it("echoes the requested facets as the viewFilter payload the UI applies", async () => {
    const res = await run({ states: ["missing"], locale: "de" });
    expect(res.ok).toBe(true);
    expect(res.viewFilter).toEqual({ states: ["missing"], locale: "de" });
    expect(typeof res.matched).toBe("number");
    expect(Array.isArray(res.sample)).toBe(true);
  });

  it("canonicalises the locale to lowercase BCP-47", async () => {
    const res = await run({ locale: "DE", states: ["machine"] });
    expect(res.viewFilter.locale).toBe("de");
  });

  it("rejects a locale the project does not have", async () => {
    await expect(run({ locale: "es" })).rejects.toThrow(/es/);
  });

  it("counts keys missing in a target locale, with a sorted sample", async () => {
    // fr is missing on plant.feed (no record) and plant.water (blank).
    const res = await run({ states: ["missing"], locale: "fr" });
    expect(res.matched).toBe(2);
    expect(res.sample).toEqual(["plant.feed", "plant.water"]);
  });

  it("counts keys by state scoped to a locale", async () => {
    const res = await run({ states: ["machine"], locale: "de" });
    // de machine: plant.water, plant.light, ui.save
    expect(res.matched).toBe(3);
  });

  it("matches a plain-text query against key path and source text", async () => {
    const res = await run({ text: "plant" });
    expect(res.matched).toBe(3);
    expect(res.sample).toEqual(["plant.feed", "plant.light", "plant.water"]);
  });

  it("honours a scoped regex query (key:/…/)", async () => {
    const res = await run({ text: "key:/^plant\\./" });
    expect(res.matched).toBe(3);
  });

  it("filters by tag", async () => {
    const res = await run({ tag: "ui" });
    expect(res.matched).toBe(1);
    expect(res.sample).toEqual(["ui.save"]);
  });

  it("an empty request clears the view (matches every key)", async () => {
    const res = await run({});
    expect(res.matched).toBe(4);
    expect(res.total).toBe(4);
    expect(res.viewFilter).toEqual({});
  });

  it("does not write the state file", async () => {
    let persisted = false;
    ctx.persist = () => { persisted = true; };
    await run({ states: ["missing"] });
    expect(persisted).toBe(false);
  });
});

describe("select_key tool", () => {
  it("returns a selectKey payload the UI opens the detail panel with", async () => {
    const res = await tool("select_key").run({ key: "plant.feed" }, ctx) as { ok: true; key: string; selectKey: string };
    expect(res).toMatchObject({ ok: true, key: "plant.feed", selectKey: "plant.feed" });
  });

  it("rejects a key that does not exist", async () => {
    await expect(tool("select_key").run({ key: "plant.nope" }, ctx)).rejects.toThrow(/plant\.nope/);
  });

  it("does not write the state file", async () => {
    let persisted = false;
    ctx.persist = () => { persisted = true; };
    await tool("select_key").run({ key: "plant.feed" }, ctx);
    expect(persisted).toBe(false);
  });
});
