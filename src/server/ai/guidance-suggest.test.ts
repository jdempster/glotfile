import { describe, it, expect } from "vitest";
import {
  buildProjectContextSystemPrompt, buildProjectContextUserPrompt, PROJECT_CONTEXT_SCHEMA,
  buildLocaleInstructionSystemPrompt, buildLocaleInstructionUserPrompt, LOCALE_INSTRUCTION_SCHEMA,
} from "./guidance-suggest.js";
import type { GlossarySource } from "./glossary-suggest.js";

const sources: GlossarySource[] = [
  { key: "nav.signIn", source: "Sign in" },
  { key: "plant.water", source: "Water" },
];

describe("project context suggestion prompts", () => {
  it("system prompt asks for a concise project description added to every translation", () => {
    const sys = buildProjectContextSystemPrompt();
    expect(sys).toMatch(/project context/i);
    expect(sys).toMatch(/product/i);
    expect(sys).toMatch(/tone|register/i);
  });

  it("user prompt includes the sampled source strings and any glossary terms", () => {
    const text = buildProjectContextUserPrompt(sources, ["Sprout"]);
    expect(text).toContain("Sign in");
    expect(text).toContain("Water");
    expect(text).toContain("Sprout");
    expect(text).toMatch(/projectContext/);
  });

  it("user prompt still renders with no glossary terms", () => {
    const text = buildProjectContextUserPrompt(sources, []);
    expect(text).toContain("Sign in");
  });

  it("schema requires a projectContext string", () => {
    const props = PROJECT_CONTEXT_SCHEMA.properties as Record<string, unknown>;
    expect(props.projectContext).toBeDefined();
    expect(PROJECT_CONTEXT_SCHEMA.required).toContain("projectContext");
  });
});

describe("per-locale instruction suggestion prompts", () => {
  it("system prompt asks for language-specific rules layered on the project context", () => {
    const sys = buildLocaleInstructionSystemPrompt();
    expect(sys).toMatch(/language/i);
    expect(sys).toMatch(/register|formal|terminology/i);
  });

  it("user prompt names the target language, includes the project context, and the samples", () => {
    const text = buildLocaleInstructionUserPrompt("fr", "Sprout is a houseplant-care app.", sources, []);
    expect(text).toContain("fr");
    expect(text).toContain("Sprout is a houseplant-care app.");
    expect(text).toContain("Sign in");
    expect(text).toMatch(/instruction/);
  });

  it("user prompt tolerates an empty project context", () => {
    const text = buildLocaleInstructionUserPrompt("de", "", sources, []);
    expect(text).toContain("de");
    expect(text).toContain("Water");
  });

  it("schema requires an instruction string", () => {
    const props = LOCALE_INSTRUCTION_SCHEMA.properties as Record<string, unknown>;
    expect(props.instruction).toBeDefined();
    expect(LOCALE_INSTRUCTION_SCHEMA.required).toContain("instruction");
  });
});
