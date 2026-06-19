import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt, buildBatchPrompt, BATCH_SCHEMA,
  buildTranslateGemmaSystemPrompt, buildTranslateGemmaUserPrompt, parseTranslateGemmaResponse,
  supportsBatchTranslate,
  type TranslationRequest, type TranslationProvider,
} from "./provider.js";

const req: TranslationRequest = {
  id: "0",
  key: "auth.signIn",
  source: "Sign in {name}",
  sourceLocale: "en",
  context: "Welcome CTA.",
  targetLocale: "fr",
  maxLength: 20,
  placeholders: ["name"],
};

const pluralReq: TranslationRequest = {
  id: "1",
  key: "cart.items",
  source: "{count} items",
  sourceLocale: "en",
  targetLocale: "pl",
  placeholders: ["count"],
  plural: {
    arg: "count",
    categories: ["one", "few", "many", "other"],
    sourceForms: { one: "{count} item", other: "{count} items" },
  },
};

describe("prompt assembly", () => {
  it("system prompt states the hard constraints", () => {
    const sys = buildSystemPrompt([req]);
    expect(sys).toMatch(/preserve/i);
    expect(sys).toMatch(/placeholder/i);
    expect(sys).toMatch(/only/i);
  });

  it("system prompt mentions the goal, glossary, and screenshots", () => {
    const sys = buildSystemPrompt([req]);
    expect(sys).toMatch(/goal/i);
    expect(sys).toMatch(/glossary/i);
    expect(sys).toMatch(/screenshot/i);
  });

  it("batch prompt includes id, source, context, maxLength, placeholders", () => {
    const text = buildBatchPrompt([req]);
    expect(text).toContain('"id": "0"');
    expect(text).toContain("Sign in {name}");
    expect(text).toContain("Welcome CTA.");
    expect(text).toContain("20");
    expect(text).toContain("name");
  });

  it("states the target locale once as a batch directive, not per item", () => {
    const text = buildBatchPrompt([req, { ...req, id: "1", key: "auth.signOut", source: "Sign out" }]);
    // The whole batch is one language — say it once, up front.
    expect(text).toContain("target locale: fr");
    // ...and never stamp targetLocale onto the individual items.
    expect(text).not.toContain('"targetLocale"');
  });

  it("system prompt tells the model to reproduce the provided literals verbatim", () => {
    const sys = buildSystemPrompt([req]);
    // references the per-item `literals` field, not just generic apostrophe advice
    expect(sys).toMatch(/literals/i);
    expect(sys).toMatch(/exactly|verbatim/i);
    expect(sys).toMatch(/'\{/);
  });

  it("batch prompt surfaces a request's literals field verbatim", () => {
    const withLiteral: TranslationRequest = {
      ...req,
      source: "Dear '{{visitor}}', visit '{{site}}'.",
      placeholders: [],
      literals: ["'{{visitor}}'", "'{{site}}'"],
    };
    const text = buildBatchPrompt([withLiteral]);
    expect(text).toContain('"literals"');
    expect(text).toContain("'{{visitor}}'");
  });

  it("system prompt includes plural handling when a request is a plural item", () => {
    const sys = buildSystemPrompt([pluralReq]);
    expect(sys).toMatch(/plural/i);
    expect(sys).toMatch(/categor/i);
    expect(sys).toMatch(/forms/i);
  });

  it("system prompt omits plural handling when no request is a plural item", () => {
    const sys = buildSystemPrompt([req]);
    expect(sys).not.toMatch(/plural items/i);
    expect(sys).not.toMatch(/\bforms\b/i);
  });

  it("batch prompt emits a plural item's required categories and source forms", () => {
    const text = buildBatchPrompt([pluralReq]);
    expect(text).toContain('"categories"');
    expect(text).toContain('"sourceForms"');
    // a required category the source does not have must be present for the model
    expect(text).toContain('"few"');
    expect(text).toContain("{count} items");
  });

  it("BATCH_SCHEMA accepts either a scalar translation or a plural forms object", () => {
    const itemProps = BATCH_SCHEMA.properties.items.items.properties as Record<string, unknown>;
    expect(itemProps.translation).toBeDefined();
    expect(itemProps.forms).toBeDefined();
  });

  it("batch prompt includes glossary hints and a hasScreenshot flag", () => {
    const withExtras: TranslationRequest = {
      ...req,
      glossary: [{ term: "Sign in", forced: "Se connecter" }],
      image: { mediaType: "image/png", base64: "AAAA" },
    };
    const text = buildBatchPrompt([withExtras]);
    expect(text).toContain("Se connecter");
    expect(text).toContain('"hasScreenshot": true');
    expect(text).toContain('"glossary"');
  });

  it("batch prompt omits the glossary field and instruction when no item has hints", () => {
    const text = buildBatchPrompt([req, pluralReq]);
    expect(text).not.toContain('"glossary"');
    expect(text).not.toMatch(/glossary/i);
  });

  it("batch prompt keeps the glossary instruction when any item has hints", () => {
    const withHints: TranslationRequest = {
      ...req,
      glossary: [{ term: "Sign in", forced: "Se connecter" }],
    };
    const text = buildBatchPrompt([withHints, { ...req, id: "1" }]);
    expect(text).toMatch(/glossary entries are constraints/i);
  });
});

describe("prompt guidance (project context + per-locale rules)", () => {
  const projectContext = "Sign In App is a visitor and contractor management system; treat 'sign in' as check-in, never login.";
  const frReq: TranslationRequest = { ...req, targetLocale: "fr", projectContext, localeInstruction: "Use vouvoiement throughout." };
  const deReq: TranslationRequest = { ...req, id: "2", targetLocale: "de", projectContext, localeInstruction: "Use the formal Sie." };

  it("injects the project context into the system prompt when a request carries it", () => {
    const sys = buildSystemPrompt([frReq]);
    expect(sys).toContain(projectContext);
    expect(sys).toMatch(/project context/i);
  });

  it("injects the per-locale instruction for a single-locale batch", () => {
    const sys = buildSystemPrompt([frReq, { ...frReq, id: "1", key: "auth.signOut" }]);
    expect(sys).toContain("Use vouvoiement throughout.");
    // labelled with the target locale so the model knows whom the rule is for
    expect(sys).toContain("fr");
  });

  it("omits the per-locale instruction when the batch spans multiple locales, but keeps the shared project context", () => {
    const sys = buildSystemPrompt([frReq, deReq]);
    expect(sys).toContain(projectContext);
    expect(sys).not.toContain("Use vouvoiement throughout.");
    expect(sys).not.toContain("Use the formal Sie.");
  });

  it("adds no project-context or locale-instruction blocks when requests carry none", () => {
    const sys = buildSystemPrompt([req]);
    expect(sys).not.toMatch(/project context/i);
    expect(sys).not.toMatch(/additional instructions/i);
  });

  it("still reports plural handling based on the requests, not a boolean flag", () => {
    expect(buildSystemPrompt([pluralReq])).toMatch(/plural items/i);
    expect(buildSystemPrompt([req])).not.toMatch(/plural items/i);
  });
});

describe("TranslationProvider interface", () => {
  it("complete() is declared on the interface", () => {
    // If the interface has complete(), TypeScript compiles; this test validates
    // the shape via a fake implementation.
    const fake: import("./provider.js").TranslationProvider = {
      translate: async () => [],
      supportsVision: () => false,
      complete: async () => ({}),
    };
    expect(typeof fake.complete).toBe("function");
  });
});

describe("supportsBatchTranslate", () => {
  const base: TranslationProvider = {
    translate: async () => [],
    supportsVision: () => false,
    complete: async () => ({}),
  };

  it("is false for a plain provider", () => {
    expect(supportsBatchTranslate(base)).toBe(false);
  });

  it("is true when the batch methods are present", () => {
    const batchy = {
      ...base,
      submitTranslationBatch: async () => "batch_1",
      translationBatchStatus: async () => ({ status: "ended" as const, counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 } }),
      translationBatchResults: async () => new Map(),
      cancelTranslationBatch: async () => {},
    };
    expect(supportsBatchTranslate(batchy)).toBe(true);
  });
});

describe("translategemma strategy", () => {
  it("system prompt includes source and target locale", () => {
    const sys = buildTranslateGemmaSystemPrompt("en", "fr");
    expect(sys).toContain("en");
    expect(sys).toContain("fr");
    expect(sys).toContain("translator");
    expect(sys).toContain("cultural");
  });

  it("system prompt instructs placeholder and markdown preservation", () => {
    const sys = buildTranslateGemmaSystemPrompt("en", "fr");
    expect(sys).toMatch(/placeholder/i);
    expect(sys).toMatch(/markdown/i);
  });

  it("system prompt folds in the project context and per-locale instruction when supplied", () => {
    const sys = buildTranslateGemmaSystemPrompt("en", "fr", {
      projectContext: "Sign In App is a visitor management system.",
      localeInstruction: "Use vouvoiement.",
    });
    expect(sys).toContain("Sign In App is a visitor management system.");
    expect(sys).toContain("Use vouvoiement.");
  });

  it("user prompt is two blank lines then the source text", () => {
    const prompt = buildTranslateGemmaUserPrompt("Hello, how are you?");
    expect(prompt).toBe("\n\nHello, how are you?");
  });

  it("parses a plain text response as a translation result", () => {
    const result = parseTranslateGemmaResponse("  Bonjour, comment allez-vous?  ", "42");
    expect(result).toEqual({ id: "42", translation: "Bonjour, comment allez-vous?" });
  });

  it("returns an error result for an empty response", () => {
    const result = parseTranslateGemmaResponse("   ", "42");
    expect(result.error).toBeTruthy();
    expect(result.id).toBe("42");
  });
});
