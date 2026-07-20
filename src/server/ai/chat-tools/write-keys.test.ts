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

  it("does not expose an add_key_note tool — Lingo has no access to the human Notes field", () => {
    expect(keyWriteTools.find((t) => t.def.name === "add_key_note")).toBeUndefined();
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

  it("set_source_text flags translations needs-review on a case-only change", async () => {
    // "Feed" -> "feed": differs only in casing, which is still a real source
    // change, so the existing machine translation must be re-reviewed.
    await tool("set_source_text").run({ key: "plant.feed", value: "feed" }, ctx);
    expect(state.keys["plant.feed"]!.values.en!.value).toBe("feed");
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

  it("add_key returns drillToKey so the UI jumps to the new key", async () => {
    const res = await tool("add_key").run({ key: "plant.repot", value: "Repot" }, ctx) as { drillToKey: string };
    expect(res.drillToKey).toBe("plant.repot");
  });

  it("delete_key removes the key and its translations entirely", async () => {
    const res = await tool("delete_key").run({ key: "plant.feed" }, ctx) as { ok: boolean; key: string };
    expect(res).toMatchObject({ ok: true, key: "plant.feed" });
    expect(state.keys["plant.feed"]).toBeUndefined();
  });

  it("delete_key rejects a key that doesn't exist", async () => {
    await expect(tool("delete_key").run({ key: "nope.missing" }, ctx)).rejects.toThrow();
  });

  it("convert_to_plural moves every locale's text into the \"other\" form and records the arg", async () => {
    const res = await tool("convert_to_plural").run({ key: "plant.feed", arg: "count" }, ctx) as { arg: string };
    expect(res.arg).toBe("count");
    expect(state.keys["plant.feed"]!.plural).toEqual({ arg: "count" });
    expect(state.keys["plant.feed"]!.values.en).toEqual({ forms: { other: "Feed" }, state: "source" });
    expect(state.keys["plant.feed"]!.values.de!.forms).toEqual({ other: "Füttern" });
  });

  it("convert_to_plural with forms writes the source forms and flags translations needs-review", async () => {
    await tool("convert_to_plural").run(
      { key: "plant.feed", arg: "count", forms: { one: "Feed {count} plant", other: "Feed {count} plants" } },
      ctx,
    );
    expect(state.keys["plant.feed"]!.values.en!.forms).toEqual({ one: "Feed {count} plant", other: "Feed {count} plants" });
    // The source wording changed, so the existing machine translation is stale.
    expect(state.keys["plant.feed"]!.values.de!.state).toBe("needs-review");
  });

  it("convert_to_plural rejects forms with an unknown selector or a missing \"other\"", async () => {
    await expect(
      tool("convert_to_plural").run({ key: "plant.feed", arg: "count", forms: { some: "x", other: "y" } }, ctx),
    ).rejects.toThrow(/selector/i);
    await expect(
      tool("convert_to_plural").run({ key: "plant.feed", arg: "count", forms: { one: "x" } }, ctx),
    ).rejects.toThrow(/other/i);
    expect(state.keys["plant.feed"]!.plural).toBeUndefined();
  });

  it("convert_to_plural rejects an already-plural key and a blank arg", async () => {
    state.keys["plant.feed"]!.plural = { arg: "count" };
    await expect(tool("convert_to_plural").run({ key: "plant.feed", arg: "count" }, ctx)).rejects.toThrow(/plural/i);
    delete state.keys["plant.feed"]!.plural;
    await expect(tool("convert_to_plural").run({ key: "plant.feed", arg: "  " }, ctx)).rejects.toThrow(/arg/i);
  });

  it("set_source_text on a plural key converts it to single with the new text", async () => {
    state.keys["plant.feed"] = {
      plural: { arg: "count" },
      values: {
        en: { forms: { one: "{count} plant", other: "{count} plants" }, state: "source" },
        de: { forms: { one: "{count} Pflanze", other: "{count} Pflanzen" }, state: "machine" },
      },
    };
    const res = await tool("set_source_text").run({ key: "plant.feed", value: "Your plants" }, ctx) as { source: string };
    expect(res.source).toBe("Your plants");
    expect(state.keys["plant.feed"]!.plural).toBeUndefined();
    expect(state.keys["plant.feed"]!.values.en).toEqual({ value: "Your plants", state: "source" });
    // The target collapses to scalar (inline ICU, so no wording is lost) and,
    // since the source wording changed, is flagged for re-review.
    expect(state.keys["plant.feed"]!.values.de!.forms).toBeUndefined();
    expect(state.keys["plant.feed"]!.values.de!.state).toBe("needs-review");
  });

  it("set_source_text on a plural key keeps translations intact when the text matches the collapsed form", async () => {
    state.keys["plant.feed"] = {
      plural: { arg: "count" },
      values: { en: { forms: { other: "Feed" }, state: "source" }, de: { forms: { other: "Füttern" }, state: "machine" } },
    };
    await tool("set_source_text").run({ key: "plant.feed", value: "Feed" }, ctx);
    // A lone "other" collapses to exactly this text, so nothing actually changed:
    // the machine translation survives un-flagged.
    expect(state.keys["plant.feed"]!.values.de).toEqual({ value: "Füttern", state: "machine" });
  });

  it("does not expose a convert_to_single tool — set_source_text on a plural key is the conversion", () => {
    expect(keyWriteTools.find((t) => t.def.name === "convert_to_single")).toBeUndefined();
  });

  it("every key-write tool is confirm-gated — edits run only after the user approves", () => {
    expect(keyWriteTools.every((t) => t.confirm === true)).toBe(true);
  });
});
