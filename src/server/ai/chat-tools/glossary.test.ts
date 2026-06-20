import { describe, it, expect, beforeEach } from "vitest";
import { glossaryWriteTools } from "./glossary.js";
import { defaultState, type State } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

const tool = (name: string): ChatTool => {
  const t = glossaryWriteTools.find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

let state: State;
let ctx: ToolContext;
beforeEach(() => {
  state = defaultState();
  state.config.locales = ["en", "de"];
  ctx = { projectRoot: "/x", statePath: "", load: () => state, persist: (s) => { state = s; }, provider: null as never };
});

describe("glossary write tools", () => {
  it("set_glossary_term adds a do-not-translate brand term", async () => {
    await tool("set_glossary_term").run({ term: "Sprout", doNotTranslate: true, notes: "brand" }, ctx);
    expect(state.glossary).toEqual([{ term: "Sprout", doNotTranslate: true, notes: "brand" }]);
  });

  it("set_glossary_term marks a brand that collides with a common word case-sensitive", async () => {
    await tool("set_glossary_term").run({ term: "Sprout", doNotTranslate: true, caseSensitive: true }, ctx);
    expect(state.glossary).toEqual([{ term: "Sprout", doNotTranslate: true, caseSensitive: true }]);
  });

  it("set_glossary_term attaches fixed translations and omits empty fields", async () => {
    await tool("set_glossary_term").run({ term: "feed", translations: { de: "düngen" } }, ctx);
    expect(state.glossary).toEqual([{ term: "feed", translations: { de: "düngen" } }]);
  });

  it("remove_glossary_term deletes by term", async () => {
    state.glossary = [{ term: "Sprout" }, { term: "feed" }];
    await tool("remove_glossary_term").run({ term: "feed" }, ctx);
    expect(state.glossary.map((g) => g.term)).toEqual(["Sprout"]);
  });

  it("accept_glossary_suggestion promotes a pending suggestion and clears it", async () => {
    state.glossarySuggestions = [{ term: "feed", note: "ambiguous", doNotTranslate: false, status: "pending" }];
    await tool("accept_glossary_suggestion").run({ term: "feed" }, ctx);
    expect(state.glossary).toEqual([{ term: "feed", notes: "ambiguous" }]);
    expect(state.glossarySuggestions).toEqual([]);
  });

  it("accept_glossary_suggestion throws when there is no pending match", async () => {
    await expect(tool("accept_glossary_suggestion").run({ term: "nope" }, ctx)).rejects.toThrow(/no pending/i);
  });

  it("dismiss_glossary_suggestion tombstones the suggestion", async () => {
    state.glossarySuggestions = [{ term: "feed", status: "pending" }];
    await tool("dismiss_glossary_suggestion").run({ term: "feed" }, ctx);
    expect(state.glossarySuggestions[0]?.status).toBe("dismissed");
  });
});
