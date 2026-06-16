import { describe, it, expect } from "vitest";
import { glossaryViolations, relevantGlossary } from "./glossary.js";

describe("relevantGlossary", () => {
  it("finds a term in the source and maps the forced translation for the locale", () => {
    const hints = relevantGlossary("Sign in to continue", "fr", [
      { term: "Sign in", translations: { fr: "Se connecter", de: "Anmelden" } },
      { term: "Logout" },
    ]);
    expect(hints).toEqual([{ term: "Sign in", doNotTranslate: undefined, forced: "Se connecter", notes: undefined }]);
  });

  it("honors case sensitivity", () => {
    const glossary = [{ term: "API", caseSensitive: true }];
    expect(relevantGlossary("the api endpoint", "fr", glossary)).toEqual([]);
    expect(relevantGlossary("the API endpoint", "fr", glossary)).toHaveLength(1);
  });

  it("matches case-insensitively by default", () => {
    expect(relevantGlossary("the login page", "fr", [{ term: "Login" }])).toHaveLength(1);
  });

  it("matches only whole words by default — a term is a word, not a substring", () => {
    expect(relevantGlossary("Process the file", "fr", [{ term: "Pro" }])).toEqual([]);
    expect(relevantGlossary("Upgrade to Pro", "fr", [{ term: "Pro" }])).toHaveLength(1);
  });

  it("matches inside a larger word when wholeWord is explicitly false", () => {
    expect(relevantGlossary("Process the file", "fr", [{ term: "Pro", wholeWord: false }])).toHaveLength(1);
  });

  it("treats an adjacent non-ASCII letter as a word character", () => {
    expect(relevantGlossary("Straße", "fr", [{ term: "Stra" }])).toEqual([]);
  });
});

describe("glossaryViolations", () => {
  it("flags an altered do-not-translate term", () => {
    const v = glossaryViolations("Open Glotfile", "Ouvrir Glotfichier", "fr", [{ term: "Glotfile", doNotTranslate: true }]);
    expect(v).toEqual([{ term: "Glotfile", expected: "Glotfile", kind: "do-not-translate" }]);
  });
  it("flags a missing forced translation", () => {
    const v = glossaryViolations("sign in", "ouvrir", "fr", [{ term: "sign in", translations: { fr: "se connecter" } }]);
    expect(v).toEqual([{ term: "sign in", expected: "se connecter", kind: "forced" }]);
  });
  it("matches case-insensitively when caseSensitive is unset", () => {
    const glossary = [{ term: "Webhook", doNotTranslate: true }];
    expect(glossaryViolations("Send to a webhook endpoint", "Lähetä webhook-päätepisteeseen", "fi", glossary)).toEqual([]);
  });
  it("matches a forced translation case-insensitively when caseSensitive is unset", () => {
    const glossary = [{ term: "sign in", translations: { fr: "se connecter" } }];
    expect(glossaryViolations("sign in", "Se connecter au portail", "fr", glossary)).toEqual([]);
  });
  it("flags a case mismatch when the entry is caseSensitive", () => {
    const glossary = [{ term: "Kiosk", doNotTranslate: true, caseSensitive: true }];
    expect(glossaryViolations("Open the Kiosk", "Ouvrir le kiosk", "fr", glossary)).toEqual([
      { term: "Kiosk", expected: "Kiosk", kind: "do-not-translate" },
    ]);
  });
  it("ignores entries whose term is absent from the source", () => {
    expect(glossaryViolations("hello", "bonjour", "fr", [{ term: "Webhook", doNotTranslate: true }])).toEqual([]);
  });
  it("prefers do-not-translate over a forced translation on the same entry", () => {
    const glossary = [{ term: "Portal", doNotTranslate: true, translations: { fr: "portail" } }];
    expect(glossaryViolations("Open the Portal", "Ouvrir le Portal", "fr", glossary)).toEqual([]);
    expect(glossaryViolations("Open the Portal", "Ouvrir le portail", "fr", glossary)).toEqual([
      { term: "Portal", expected: "Portal", kind: "do-not-translate" },
    ]);
  });

  it("does not apply a term to a larger source word by default (whole-word)", () => {
    const glossary = [{ term: "Pro", doNotTranslate: true }];
    expect(glossaryViolations("Process the file", "Traiter le fichier", "fr", glossary)).toEqual([]);
  });

  it("does not apply a forced term to a larger source word by default", () => {
    const glossary = [{ term: "cat", translations: { fr: "chat" } }];
    expect(glossaryViolations("category list", "liste de catégories", "fr", glossary)).toEqual([]);
  });

  it("flags a standalone do-not-translate term that the translation dropped", () => {
    const glossary = [{ term: "Pro", doNotTranslate: true }];
    expect(glossaryViolations("Upgrade to Pro", "Passer à Pro", "fr", glossary)).toEqual([]);
    expect(glossaryViolations("Upgrade to Pro", "Passer à la version", "fr", glossary)).toEqual([
      { term: "Pro", expected: "Pro", kind: "do-not-translate" },
    ]);
  });

  it("treats an inflected or compounded translation as honoring the term (lenient value match)", () => {
    const glossary = [{ term: "Webhook", doNotTranslate: true }];
    // "Webhooks" still contains "Webhook"; whole-word value matching would wrongly flag this.
    expect(glossaryViolations("The Webhook is ready", "Die Webhooks sind bereit", "de", glossary)).toEqual([]);
  });

  it("applies a term inside a larger source word when wholeWord is false", () => {
    const glossary = [{ term: "Pro", doNotTranslate: true, wholeWord: false }];
    expect(glossaryViolations("Process the file", "Traiter le fichier", "fr", glossary)).toEqual([
      { term: "Pro", expected: "Pro", kind: "do-not-translate" },
    ]);
  });
});
