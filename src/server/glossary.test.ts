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
});
