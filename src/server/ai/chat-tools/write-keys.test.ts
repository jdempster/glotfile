import { describe, it, expect, beforeEach } from "vitest";
import { keyWriteTools } from "./write-keys.js";
import { defaultState, type State } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

const tool = (name: string): ChatTool => {
  const t = keyWriteTools.find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

let state: State;
let ctx: ToolContext;
beforeEach(() => {
  state = defaultState();
  state.config.locales = ["en", "de"];
  state.keys = {
    "plant.feed": { values: { en: { value: "Feed", state: "source" }, de: { value: "Füttern", state: "machine" } } },
  };
  ctx = { projectRoot: "/x", statePath: "", load: () => state, persist: (s) => { state = s; }, provider: null as never };
});

describe("key write tools", () => {
  it("set_key_context writes human-authored context", async () => {
    state.keys["plant.feed"]!.contextSource = "ai";
    await tool("set_key_context").run({ key: "plant.feed", context: "Button: fertilise the plant." }, ctx);
    expect(state.keys["plant.feed"]!.context).toBe("Button: fertilise the plant.");
    // Writing context promotes it from AI-generated to human-authored.
    expect(state.keys["plant.feed"]!.contextSource).toBeUndefined();
  });

  it("set_key_context with blank text clears the field", async () => {
    state.keys["plant.feed"]!.context = "old";
    await tool("set_key_context").run({ key: "plant.feed", context: "  " }, ctx);
    expect(state.keys["plant.feed"]!.context).toBeUndefined();
  });

  it("add_key_note appends a note and returns its id", async () => {
    const res = await tool("add_key_note").run({ key: "plant.feed", text: "Confirm with design." }, ctx) as { noteId: string };
    expect(state.keys["plant.feed"]!.notes?.map((n) => n.text)).toEqual(["Confirm with design."]);
    expect(typeof res.noteId).toBe("string");
  });

  it("set_translation sets the value, marks it reviewed, and canonicalises the locale", async () => {
    await tool("set_translation").run({ key: "plant.feed", locale: "DE", value: "Düngen" }, ctx);
    expect(state.keys["plant.feed"]!.values.de).toEqual({ value: "Düngen", state: "reviewed" });
  });

  it("set_translation_state flips review state without touching the text", async () => {
    await tool("set_translation_state").run({ key: "plant.feed", locale: "de", state: "reviewed" }, ctx);
    expect(state.keys["plant.feed"]!.values.de).toEqual({ value: "Füttern", state: "reviewed" });
  });
});
