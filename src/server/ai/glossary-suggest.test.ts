import { describe, expect, test } from "vitest";
import {
  selectGlossarySources, buildGlossarySuggestSystemPrompt, buildGlossarySuggestBatchPrompt,
  GLOSSARY_SUGGEST_SCHEMA, dedupeTerms, knownTermList,
} from "./glossary-suggest.js";
import { defaultState } from "../schema.js";

function st() {
  const s = defaultState();
  s.config.sourceLocale = "en"; s.config.locales = ["en"];
  s.keys = {
    "x": { values: { en: { value: "Sign in to Acme", state: "source" } } },
    "y": { values: { en: { value: "", state: "source" } } },
  } as any;
  return s;
}

test("selectGlossarySources returns non-empty sources only, with key+source", () => {
  const out = selectGlossarySources(st(), {});
  expect(out).toEqual([{ key: "x", source: "Sign in to Acme" }]);
});

test("selectGlossarySources honors keyGlob and limit", () => {
  const s = st();
  s.keys["z"] = { values: { en: { value: "Other", state: "source" } } } as any;
  expect(selectGlossarySources(s, { keyGlob: "z" }).map((r) => r.key)).toEqual(["z"]);
  expect(selectGlossarySources(s, { limit: 1 })).toHaveLength(1);
});

test("knownTermList merges glossary + suggestion terms", () => {
  const s = st();
  s.glossary = [{ term: "Acme" }] as any;
  s.glossarySuggestions = [{ term: "Foo", status: "dismissed" }] as any;
  expect(knownTermList(s).sort()).toEqual(["Acme", "Foo"]);
});

test("batch prompt includes the known terms to skip and the sources", () => {
  const p = buildGlossarySuggestBatchPrompt([{ key: "x", source: "Sign in to Acme" }], ["Widget"]);
  expect(p).toContain("Widget");
  expect(p).toContain("Sign in to Acme");
});

test("dedupeTerms collapses case-variant duplicates, first wins", () => {
  const out = dedupeTerms([{ term: "Acme", note: "a" }, { term: "acme", note: "b" }, { term: "Beta" }]);
  expect(out.map((t) => t.term)).toEqual(["Acme", "Beta"]);
});

test("schema requires term, allows the optional fields", () => {
  const props = (GLOSSARY_SUGGEST_SCHEMA as any).properties.terms.items;
  expect(props.required).toEqual(["term"]);
  expect(Object.keys(props.properties).sort()).toEqual(["caseSensitive", "doNotTranslate", "note", "term", "wholeWord"]);
});
