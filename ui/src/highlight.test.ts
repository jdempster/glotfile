import { describe, it, expect } from "vitest";
import { highlightSegments } from "./highlight.js";

describe("highlightSegments", () => {
  it("splits a single {name} placeholder with surrounding text", () => {
    expect(highlightSegments("Hi {name}!")).toEqual([
      { text: "Hi ", placeholder: false },
      { text: "{name}", placeholder: true },
      { text: "!", placeholder: false },
    ]);
  });

  it("does not highlight non-canonical tokens (:name, %s)", () => {
    expect(highlightSegments("Use :name and %s here")).toEqual([
      { text: "Use :name and %s here", placeholder: false },
    ]);
  });

  it("treats an apostrophe-quoted brace as literal, not a placeholder", () => {
    expect(highlightSegments("'{name}'")).toEqual([
      { text: "'{name}'", placeholder: false },
    ]);
  });

  it("highlights a real token alongside a quoted literal", () => {
    expect(highlightSegments("Show '{name}' but use {real}")).toEqual([
      { text: "Show '{name}' but use ", placeholder: false },
      { text: "{real}", placeholder: true },
    ]);
  });

  it("treats a full ICU plural block as a single placeholder segment", () => {
    const value = "You have {count, plural, one {# item} other {# items}}.";
    const segments = highlightSegments(value);
    expect(segments).toEqual([
      { text: "You have ", placeholder: false },
      { text: "{count, plural, one {# item} other {# items}}", placeholder: true },
      { text: ".", placeholder: false },
    ]);
  });

  it("returns a single non-placeholder segment for plain text", () => {
    expect(highlightSegments("Just plain text")).toEqual([
      { text: "Just plain text", placeholder: false },
    ]);
  });

  it("does not highlight a colon glued to a word, e.g. a time format", () => {
    expect(highlightSegments("Duration (h:m)")).toEqual([
      { text: "Duration (h:m)", placeholder: false },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(highlightSegments("")).toEqual([]);
  });
});
