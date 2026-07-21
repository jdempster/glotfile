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

  it("system prompt explains the role and the propose-then-approve behaviour", () => {
    const prompt = buildChatSystemPrompt();
    expect(prompt).toContain("Lingo");
    // Edits are gated behind the UI's Approve button, not a typed "yes".
    expect(prompt).toContain("Approve button");
    expect(prompt.toLowerCase()).toContain("green light");
    // Approval is per-task, so a multi-step task runs without re-asking per edit.
    expect(prompt).toContain("not fresh approval for each individual edit");
  });

  it("the system prompt is static — the volatile snapshot is delivered separately", () => {
    // Keeping the snapshot OUT of the system prompt is what lets the prompt cache
    // stay warm across turns, so guard against it creeping back in.
    expect(buildChatSystemPrompt()).not.toContain("Current project snapshot:");
  });

  it("appends custom chat instructions as a fenced final section", () => {
    const prompt = buildChatSystemPrompt("Answer in British English. Call locales 'markets'.");
    expect(prompt).toContain("Answer in British English. Call locales 'markets'.");
    // Framed as team tuning that cannot mint new abilities or bypass approval.
    expect(prompt).toContain("Custom instructions from this project's team");
    expect(prompt).toContain("cannot grant tools or abilities");
    // Appended after the built-in behaviour rules, never before them.
    expect(prompt.indexOf("Custom instructions")).toBeGreaterThan(prompt.indexOf("Approve button"));
  });

  it("omits the custom section when instructions are absent or blank", () => {
    expect(buildChatSystemPrompt()).not.toContain("Custom instructions");
    expect(buildChatSystemPrompt("  \n ")).not.toContain("Custom instructions");
  });
});
