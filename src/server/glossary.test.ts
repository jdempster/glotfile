import { describe, it, expect, test } from "vitest";
import { glossaryViolations, relevantGlossary, matchGlossary, matchGlossaryForms, glossaryHints, sourceKeysForTerm } from "./glossary.js";
import { defaultState } from "./schema.js";

describe("relevantGlossary", () => {
  it("finds a term in the source and maps the forced translation for the locale", () => {
    const hints = relevantGlossary("Sign in to continue", "fr", [
      { term: "Sign in", translations: { fr: "Se connecter", de: "Anmelden" } },
      { term: "Logout" },
    ]);
    expect(hints).toEqual([{ term: "Sign in", doNotTranslate: undefined, forced: "Se connecter", notes: undefined }]);
  });

  it("matches case-insensitively", () => {
    expect(relevantGlossary("the API endpoint", "fr", [{ term: "api" }])).toHaveLength(1);
    expect(relevantGlossary("the api endpoint", "fr", [{ term: "API" }])).toHaveLength(1);
  });

  it("matches only whole words — a term is a word, not a substring", () => {
    expect(relevantGlossary("Process the file", "fr", [{ term: "Pro" }])).toEqual([]);
    expect(relevantGlossary("Upgrade to Pro", "fr", [{ term: "Pro" }])).toHaveLength(1);
  });

  it("matches an inflected form listed as an alias", () => {
    const glossary = [{ term: "feed", aliases: ["feeding", "feeds"] }];
    expect(relevantGlossary("Feeding schedule", "de", glossary)).toHaveLength(1);
    // ...but still not a substring of an unrelated word.
    expect(relevantGlossary("Feedback form", "de", glossary)).toEqual([]);
  });

  it("does NOT carry a forced translation on an alias-only match", () => {
    // The alias is an inflected source form whose target rendering differs from
    // the pinned word, so we offer the term as a hint but not the forced string.
    const glossary = [{ term: "feed", aliases: ["feeding"], translations: { de: "düngen" } }];
    expect(relevantGlossary("Feeding schedule", "de", glossary)).toEqual([
      { term: "feed", doNotTranslate: undefined, forced: undefined, notes: undefined },
    ]);
    // The canonical term still carries it.
    expect(relevantGlossary("Time to feed", "de", glossary)[0]!.forced).toBe("düngen");
  });

  it("never emits a forced translation for a do-not-translate term", () => {
    const glossary = [{ term: "Sprout", doNotTranslate: true, translations: { de: "Spross" } }];
    expect(relevantGlossary("Open Sprout", "de", glossary)).toEqual([
      { term: "Sprout", doNotTranslate: true, forced: undefined, notes: undefined },
    ]);
  });

  it("treats an adjacent non-ASCII letter as a word character", () => {
    expect(relevantGlossary("Straße", "fr", [{ term: "Stra" }])).toEqual([]);
  });
});

describe("matchGlossaryForms", () => {
  it("matches a term present in any plural form, not just `other`", () => {
    const glossary = [{ term: "plant" }];
    // "plant" appears only in the `one` form here.
    const matches = matchGlossaryForms(["1 plant", "{count} pots"], glossary);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.canonical).toBe(true);
  });

  it("keeps word boundaries across forms (no cross-form false match)", () => {
    // Joining forms must not let the end of one form + start of the next form a word.
    const glossary = [{ term: "ab" }];
    expect(matchGlossaryForms(["xa", "bx"], glossary)).toEqual([]);
  });
});

describe("glossaryHints", () => {
  it("is locale-independent for matching but locale-specific for forced", () => {
    const matches = matchGlossary("Time to feed", [{ term: "feed", translations: { de: "düngen", fr: "nourrir" } }]);
    expect(glossaryHints(matches, "de")[0]!.forced).toBe("düngen");
    expect(glossaryHints(matches, "fr")[0]!.forced).toBe("nourrir");
    expect(glossaryHints(matches, "es")[0]!.forced).toBeUndefined();
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
  it("matches the do-not-translate term case-insensitively", () => {
    const glossary = [{ term: "Webhook", doNotTranslate: true }];
    expect(glossaryViolations("Send to a webhook endpoint", "Lähetä webhook-päätepisteeseen", "fi", glossary)).toEqual([]);
  });
  it("matches a forced translation case-insensitively", () => {
    const glossary = [{ term: "sign in", translations: { fr: "se connecter" } }];
    expect(glossaryViolations("sign in", "Se connecter au portail", "fr", glossary)).toEqual([]);
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

  it("does not apply a term to a larger source word (whole-word)", () => {
    const glossary = [{ term: "Pro", doNotTranslate: true }];
    expect(glossaryViolations("Process the file", "Traiter le fichier", "fr", glossary)).toEqual([]);
  });

  it("does not apply a forced term to a larger source word", () => {
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

  it("does NOT enforce a forced translation on an alias-only match", () => {
    // Source uses the inflected alias, whose German renders differently from the
    // pinned base word — enforcing "düngen" here would mis-flag a good translation.
    const glossary = [{ term: "feed", aliases: ["feeding"], translations: { de: "düngen" } }];
    expect(glossaryViolations("Feeding schedule", "Düngeplan", "de", glossary)).toEqual([]);
  });

  it("honors a do-not-translate term kept via its alias", () => {
    const glossary = [{ term: "Webhook", aliases: ["Webhooks"], doNotTranslate: true }];
    expect(glossaryViolations("Manage Webhooks", "Webhooks verwalten", "de", glossary)).toEqual([]);
    expect(glossaryViolations("Manage Webhooks", "Haken verwalten", "de", glossary)).toEqual([
      { term: "Webhook", expected: "Webhook", kind: "do-not-translate" },
    ]);
  });
});

describe("case-sensitive terms", () => {
  it("matches only the exact case when caseSensitive is set", () => {
    const glossary = [{ term: "Sprout", caseSensitive: true }];
    // The capitalized brand applies...
    expect(relevantGlossary("Open Sprout", "fr", glossary)).toHaveLength(1);
    // ...but the lowercase common noun (a new shoot) is a different word-sense — not matched.
    expect(relevantGlossary("a new sprout appeared", "fr", glossary)).toEqual([]);
  });

  it("still matches case-insensitively by default", () => {
    expect(relevantGlossary("a new sprout appeared", "fr", [{ term: "Sprout" }])).toHaveLength(1);
  });

  it("applies case-sensitivity to aliases too", () => {
    const glossary = [{ term: "Sprout", aliases: ["Sprouts"], caseSensitive: true }];
    expect(relevantGlossary("Two Sprouts ready", "fr", glossary)).toHaveLength(1);
    expect(relevantGlossary("two sprouts ready", "fr", glossary)).toEqual([]);
  });

  it("enforces the exact case for a case-sensitive do-not-translate term", () => {
    const glossary = [{ term: "Sprout", doNotTranslate: true, caseSensitive: true }];
    // Kept verbatim → honored.
    expect(glossaryViolations("Open Sprout", "Ouvrir Sprout", "fr", glossary)).toEqual([]);
    // Translated as the common noun → the lowercase form does not satisfy the keep.
    expect(glossaryViolations("Open Sprout", "Ouvrir la pousse", "fr", glossary)).toEqual([
      { term: "Sprout", expected: "Sprout", kind: "do-not-translate" },
    ]);
  });

  it("does not apply (or flag) the lowercase common-noun sense", () => {
    const glossary = [{ term: "Sprout", doNotTranslate: true, caseSensitive: true }];
    // Source is the common noun, so the term must not apply — translating it freely is fine.
    expect(glossaryViolations("a new sprout appeared", "une nouvelle pousse est apparue", "fr", glossary)).toEqual([]);
  });
});

test("sourceKeysForTerm finds keys whose source contains the term (whole-word)", () => {
  const s = defaultState();
  s.config.sourceLocale = "en"; s.config.locales = ["en"];
  s.keys = {
    "a": { values: { en: { value: "Welcome to Acme", state: "source" } } },
    "b": { values: { en: { value: "Acmeification", state: "source" } } },
    "c": { values: { en: { value: "no term here", state: "source" } } },
  } as any;
  expect(sourceKeysForTerm(s, "Acme").sort()).toEqual(["a"]); // "Acmeification" excluded by whole-word
});
