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

  it("set_translation warns (but does not block) when a translation breaches the glossary", async () => {
    state.glossary = [{ term: "Feed", doNotTranslate: true }];
    const res = await tool("set_translation").run(
      { key: "plant.feed", locale: "de", value: "Düngen" }, ctx,
    ) as { ok: boolean; glossaryWarnings?: string[] };
    // The write still lands...
    expect(state.keys["plant.feed"]!.values.de!.value).toBe("Düngen");
    expect(res.ok).toBe(true);
    // ...but the dropped do-not-translate term is surfaced back to the assistant.
    expect(res.glossaryWarnings).toHaveLength(1);
    expect(res.glossaryWarnings![0]).toContain("Feed");
  });

  it("set_translation returns no warnings when the glossary is honored", async () => {
    state.glossary = [{ term: "Feed", doNotTranslate: true }];
    const res = await tool("set_translation").run(
      { key: "plant.feed", locale: "de", value: "Feed läuft" }, ctx,
    ) as { glossaryWarnings?: string[] };
    expect(res.glossaryWarnings).toBeUndefined();
  });

  it("add_key_tag adds a tag and is idempotent", async () => {
    await tool("add_key_tag").run({ key: "plant.feed", tag: "cta" }, ctx);
    await tool("add_key_tag").run({ key: "plant.feed", tag: "cta" }, ctx);
    expect(state.keys["plant.feed"]!.tags).toEqual(["cta"]);
  });

  it("remove_key_tag drops a tag and clears the field when the last one goes", async () => {
    state.keys["plant.feed"]!.tags = ["cta", "home"];
    const res = await tool("remove_key_tag").run({ key: "plant.feed", tag: "cta" }, ctx) as { tags: string[] };
    expect(res.tags).toEqual(["home"]);
    await tool("remove_key_tag").run({ key: "plant.feed", tag: "home" }, ctx);
    expect(state.keys["plant.feed"]!.tags).toBeUndefined();
  });

  it("set_max_length sets the cap, and 0 clears it", async () => {
    await tool("set_max_length").run({ key: "plant.feed", maxLength: 40 }, ctx);
    expect(state.keys["plant.feed"]!.maxLength).toBe(40);
    await tool("set_max_length").run({ key: "plant.feed", maxLength: 0 }, ctx);
    expect(state.keys["plant.feed"]!.maxLength).toBeUndefined();
  });

  it("set_source_text updates the source and flags translated targets needs-review", async () => {
    await tool("set_source_text").run({ key: "plant.feed", value: "Feed the plant" }, ctx);
    expect(state.keys["plant.feed"]!.values.en!.value).toBe("Feed the plant");
    // changing the source invalidates the existing machine translation
    expect(state.keys["plant.feed"]!.values.de!.state).toBe("needs-review");
  });

  it("add_key creates a new scalar key with source text in the source locale", async () => {
    const res = await tool("add_key").run({ key: "plant.repot", value: "Repot" }, ctx) as { key: string };
    expect(res.key).toBe("plant.repot");
    expect(state.keys["plant.repot"]!.values.en).toEqual({ value: "Repot", state: "source" });
  });

  it("add_key rejects a key that already exists", async () => {
    await expect(tool("add_key").run({ key: "plant.feed", value: "x" }, ctx)).rejects.toThrow(/exist/i);
  });
});
