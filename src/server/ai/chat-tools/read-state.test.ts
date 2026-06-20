import { describe, it, expect } from "vitest";
import { stateReadTools } from "./read-state.js";
import { defaultState, type State } from "../../schema.js";
import type { ChatTool, ToolContext } from "../chat-types.js";

const tool = (name: string): ChatTool => {
  const t = stateReadTools.find((x) => x.def.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

// A Sprout houseplant-care fixture: en source, de partially translated.
function sproutState(): State {
  const s = defaultState();
  s.config.locales = ["en", "de"];
  s.config.projectContext = "Sprout is a houseplant-care app; treat 'feed' as giving a plant fertilizer, never as a social-media feed.";
  s.config.localeInstructions = { de: "Use informal du." };
  s.glossary = [{ term: "Sprout", doNotTranslate: true, notes: "product name" }];
  s.keys = {
    "plant.water": { values: { en: { value: "Water your plant", state: "source" } } },
    "plant.feed": {
      context: "Button to fertilize a plant.",
      values: {
        en: { value: "Feed your plant {gardener}", state: "source" },
        de: { value: "Dünge deine Pflanze {gardener}", state: "reviewed" },
      },
    },
  };
  return s;
}

const ctxFor = (s: State): ToolContext => ({ projectRoot: "/x", statePath: "", load: () => s, persist: () => {}, provider: null as never });

describe("state read tools", () => {
  const ctx = ctxFor(sproutState());

  it("overview reports locales, key count, and guidance flags", async () => {
    const o = (await tool("overview").run({}, ctx)) as {
      sourceLocale: string; locales: string[]; keyCount: number;
      perLocale: { locale: string; missing: number }[];
      guidance: { hasProjectContext: boolean; glossaryTermCount: number };
    };
    expect(o.sourceLocale).toBe("en");
    expect(o.locales).toContain("de");
    expect(o.keyCount).toBe(2);
    expect(o.perLocale.find((l) => l.locale === "de")!.missing).toBe(1);
    expect(o.guidance.hasProjectContext).toBe(true);
    expect(o.guidance.glossaryTermCount).toBe(1);
  });

  it("search_keys matches on source text", async () => {
    const r = (await tool("search_keys").run({ query: "feed" }, ctx)) as { keys: { key: string }[] };
    expect(r.keys.map((k) => k.key)).toContain("plant.feed");
    expect(r.keys.map((k) => k.key)).not.toContain("plant.water");
  });

  it("search_keys matches on key glob", async () => {
    const r = (await tool("search_keys").run({ keyGlob: "plant.*" }, ctx)) as { keys: { key: string }[] };
    expect(r.keys.map((k) => k.key).sort()).toEqual(["plant.feed", "plant.water"]);
  });

  it("read_key returns source, context, and per-locale state", async () => {
    const r = (await tool("read_key").run({ key: "plant.feed" }, ctx)) as {
      source: string; context?: string; values: Record<string, { state: string; value?: string }>;
    };
    expect(r.source).toContain("Feed your plant");
    expect(r.context).toContain("fertilize");
    expect(r.values.de!.state).toBe("reviewed");
  });

  it("grep_source matches a regex over source text that substring search can't express", async () => {
    const s = sproutState();
    s.keys = {
      "auth.sign_in": { values: { en: { value: "Sign-in to Sprout", state: "source" } } },
      "auth.signin_alt": { values: { en: { value: "Signin reminder", state: "source" } } },
      "plant.water": { values: { en: { value: "Water your plant", state: "source" } } },
    };
    const r = (await tool("grep_source").run({ pattern: "[Ss]ign-?in" }, ctxFor(s))) as
      { matches: { key: string; value: string }[] };
    expect(r.matches.map((m) => m.key).sort()).toEqual(["auth.sign_in", "auth.signin_alt"]);
    expect(r.matches.find((m) => m.key === "auth.sign_in")!.value).toBe("Sign-in to Sprout");
  });

  it("grep_source is case-sensitive by default, case-insensitive with flag i", async () => {
    const s = sproutState();
    s.keys = {
      "rooms.spaces": { values: { en: { value: "Spaces are bookable desks", state: "source" } } },
      "verb.spaces": { values: { en: { value: "Add extra spaces between rows", state: "source" } } },
    };
    const sensitive = (await tool("grep_source").run({ pattern: "Spaces" }, ctxFor(s))) as { matches: { key: string }[] };
    expect(sensitive.matches.map((m) => m.key)).toEqual(["rooms.spaces"]);
    const insensitive = (await tool("grep_source").run({ pattern: "spaces", flags: "i" }, ctxFor(s))) as { matches: { key: string }[] };
    expect(insensitive.matches.map((m) => m.key).sort()).toEqual(["rooms.spaces", "verb.spaces"]);
  });

  it("grep_source searches a target locale's translations when locale is given", async () => {
    const r = (await tool("grep_source").run({ pattern: "Pflanze", locale: "de" }, ctx)) as
      { matches: { key: string; locale: string }[] };
    expect(r.matches.map((m) => m.key)).toEqual(["plant.feed"]);
    expect(r.matches[0]!.locale).toBe("de");
  });

  it("grep_source rejects stateful flags and invalid regex", async () => {
    await expect(tool("grep_source").run({ pattern: "x", flags: "g" }, ctx)).rejects.toThrow();
    await expect(tool("grep_source").run({ pattern: "(" }, ctx)).rejects.toThrow();
  });

  it("read_guidance returns project context, locale rules, and glossary", async () => {
    const r = (await tool("read_guidance").run({}, ctx)) as {
      projectContext: string; localeInstructions: Record<string, string>;
      glossary: { term: string }[];
    };
    expect(r.projectContext).toContain("Sprout");
    expect(r.localeInstructions.de).toContain("informal");
    expect(r.glossary.map((g) => g.term)).toContain("Sprout");
  });
});
