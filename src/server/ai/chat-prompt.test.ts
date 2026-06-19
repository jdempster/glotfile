import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt, projectSnapshot } from "./chat-prompt.js";
import { defaultState, type State } from "../schema.js";

function sproutState(): State {
  const s = defaultState();
  s.config.locales = ["en", "de"];
  s.config.projectContext = "Sprout is a houseplant-care app.";
  s.keys = { "plant.water": { values: { en: { value: "Water your plant", state: "source" } } } };
  return s;
}

describe("chat system prompt", () => {
  it("snapshot reflects locales, key count, and guidance presence", () => {
    const snap = projectSnapshot(sproutState());
    expect(snap).toContain("Source locale: en");
    expect(snap).toContain("de");
    expect(snap).toContain("Keys: 1");
    expect(snap).toContain("Project context: set");
  });

  it("snapshot flags missing project context", () => {
    const s = sproutState();
    s.config.projectContext = "";
    expect(projectSnapshot(s)).toContain("Project context: NOT set");
  });

  it("system prompt explains the role, propose-and-wait, and the interview", () => {
    const prompt = buildChatSystemPrompt();
    expect(prompt).toContain("Lingo");
    expect(prompt).toContain("PROPOSE, then WAIT");
    expect(prompt.toLowerCase()).toContain("one question");
  });

  it("the system prompt is static — the volatile snapshot is delivered separately", () => {
    // Keeping the snapshot OUT of the system prompt is what lets the prompt cache
    // stay warm across turns, so guard against it creeping back in.
    expect(buildChatSystemPrompt()).not.toContain("Current project snapshot:");
  });
});
