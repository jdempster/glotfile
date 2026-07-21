import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retranslateTools } from "./retranslate.js";
import { buildToolRegistry } from "./index.js";
import { defaultState, type State } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";
import type { ChatProvider, TranslationRequest } from "../provider.js";

const retranslate = retranslateTools.find((t) => t.def.name === "retranslate") as ChatTool;

function makeProvider(seen: TranslationRequest[][]): ChatProvider {
  return {
    supportsVision: () => false,
    complete: async () => ({}),
    translate: async (reqs: TranslationRequest[]) => {
      seen.push([...reqs]);
      return reqs.map((r) => ({ id: r.id, translation: `neu:${r.source}` }));
    },
    chat: () => { throw new Error("not used"); },
  } as unknown as ChatProvider;
}

let root: string;
let state: State;
let seen: TranslationRequest[][];
let ctx: ToolContext;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "glotfile-lingo-rt-"));
  state = defaultState();
  state.config.sourceLocale = "en";
  state.config.locales = ["en", "de", "fr"];
  state.keys = {
    "plant.feed": { values: { en: { value: "Feed", state: "source" }, de: { value: "Feed", state: "machine" }, fr: { value: "Nourrir", state: "machine" } } },
    "plant.water": { values: { en: { value: "Water", state: "source" }, de: { value: "Wasser", state: "machine" } } },
  };
  seen = [];
  ctx = { projectRoot: root, statePath: join(root, "glotfile.json"), load: () => state, persist: (s) => { state = s; }, provider: makeProvider(seen) };
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("retranslate tool", () => {
  it("is registered and confirm-gated", () => {
    expect(buildToolRegistry().some((t) => t.def.name === "retranslate")).toBe(true);
    expect(retranslate.confirm).toBe(true);
  });

  it("re-runs the pipeline on exactly the named cells, overwriting existing values", async () => {
    const res = await retranslate.run({ cells: [{ key: "plant.feed", locale: "de" }] }, ctx) as { written: number };
    expect(res.written).toBe(1);
    expect(state.keys["plant.feed"]!.values.de?.value).toBe("neu:Feed");
    // Only the named cell was sent — fr and the other key were never re-rolled.
    expect(seen.flat().map((r) => `${r.key}/${r.targetLocale}`)).toEqual(["plant.feed/de"]);
    expect(state.keys["plant.feed"]!.values.fr?.value).toBe("Nourrir");
    expect(state.keys["plant.water"]!.values.de?.value).toBe("Wasser");
  });

  it("handles cells across several keys and locales without re-rolling the full product", async () => {
    await retranslate.run({ cells: [{ key: "plant.feed", locale: "fr" }, { key: "plant.water", locale: "de" }] }, ctx);
    const sent = seen.flat().map((r) => `${r.key}/${r.targetLocale}`).sort();
    // The keys × locales product would be 4 cells; only the 2 requested go out.
    expect(sent).toEqual(["plant.feed/fr", "plant.water/de"]);
  });

  it("rejects unknown keys, unknown locales, and the source locale", async () => {
    await expect(retranslate.run({ cells: [{ key: "nope", locale: "de" }] }, ctx)).rejects.toThrow(/Unknown key/);
    await expect(retranslate.run({ cells: [{ key: "plant.feed", locale: "xx" }] }, ctx)).rejects.toThrow(/Unknown locale/);
    await expect(retranslate.run({ cells: [{ key: "plant.feed", locale: "en" }] }, ctx)).rejects.toThrow(/source locale/);
  });

  it("rejects an empty or oversized cell list", async () => {
    await expect(retranslate.run({ cells: [] }, ctx)).rejects.toThrow(/non-empty/);
    const cells = Array.from({ length: 101 }, (_, i) => ({ key: "plant.feed", locale: i % 2 ? "de" : "fr" }));
    await expect(retranslate.run({ cells }, ctx)).rejects.toThrow(/At most 100/);
  });

  it("summarises the batch for the approve card", () => {
    const s = retranslate.humanSummary({ cells: [{ key: "a", locale: "de" }, { key: "b", locale: "fr" }, { key: "c", locale: "de" }] });
    expect(s).toContain("3 string(s)");
    expect(s).toContain("de, fr");
  });
});
