import { describe, it, expect, beforeEach } from "vitest";
import { guidanceWriteTools } from "./write-guidance.js";
import { defaultState, type State } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

const tool = (name: string): ChatTool => {
  const t = guidanceWriteTools.find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

const SPROUT = "Sprout is a houseplant-care app; treat 'feed' as giving a plant fertilizer, never as a social-media feed.";

let state: State;
let ctx: ToolContext;
beforeEach(() => {
  state = defaultState();
  state.config.locales = ["en", "de"];
  ctx = { projectRoot: "/x", statePath: "", load: () => state, persist: (s) => { state = s; }, provider: null as never };
});

describe("guidance write tools", () => {
  it("set_project_context writes the field and leaves the rest of config intact", async () => {
    const outputsBefore = JSON.stringify(state.config.outputs);
    await tool("set_project_context").run({ text: SPROUT }, ctx);
    expect(state.config.projectContext).toBe(SPROUT);
    expect(state.config.locales).toEqual(["en", "de"]);
    expect(JSON.stringify(state.config.outputs)).toBe(outputsBefore);
  });

  it("set_project_context with blank text clears the field", async () => {
    state.config.projectContext = SPROUT;
    await tool("set_project_context").run({ text: "   " }, ctx);
    expect(state.config.projectContext).toBe("");
  });

  it("set_locale_instruction canonicalises the locale key", async () => {
    await tool("set_locale_instruction").run({ locale: "DE", text: "Use informal du." }, ctx);
    expect(state.config.localeInstructions).toEqual({ de: "Use informal du." });
  });

  it("set_locale_instruction with blank text removes that locale's rule", async () => {
    state.config.localeInstructions = { de: "old", fr: "garde" };
    await tool("set_locale_instruction").run({ locale: "de", text: "" }, ctx);
    expect(state.config.localeInstructions).toEqual({ fr: "garde" });
  });
});
