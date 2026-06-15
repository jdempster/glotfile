import { describe, it, expect } from "vitest";
import { extractPlaceholders, extractLiterals, toLaravel, toI18next, toRuby, isIcuPluralOrSelect, placeholdersMatch, placeholdersSubset } from "./placeholders.js";

describe("extractPlaceholders", () => {
  it("extracts canonical {name} tokens", () => {
    expect(extractPlaceholders("Hi {name}, you have {count} files").sort()).toEqual(["count", "name"]);
  });
  it("captures ICU plural/select/selectordinal argument names, not branch bodies", () => {
    expect(extractPlaceholders("{count, plural, one {# item} other {# items}}")).toEqual(["count"]);
    expect(extractPlaceholders("{gender, select, male {He} female {She} other {They}}")).toEqual(["gender"]);
    expect(extractPlaceholders("{place, selectordinal, one {#st} other {#th}}")).toEqual(["place"]);
  });
  it("ignores non-canonical flavors — laravel :name and printf %s/%d are not tokens", () => {
    expect(extractPlaceholders("Hi :name, %s of %d done")).toEqual([]);
  });
  it("does not mistake a colon in plain text for a placeholder", () => {
    expect(extractPlaceholders("Duration (h:m)")).toEqual([]);
    expect(extractPlaceholders("Starts at 12:30")).toEqual([]);
  });
  it("treats an ICU-apostrophe-quoted span as literal text, not a token", () => {
    expect(extractPlaceholders("'{name}'")).toEqual([]);
    expect(extractPlaceholders("Wrap '{' and '}' literally")).toEqual([]);
    expect(extractPlaceholders("Show '{name}' but use {real}")).toEqual(["real"]);
  });
});

describe("extractLiterals", () => {
  it("returns the unescaped content of each ICU-quoted literal span", () => {
    expect(extractLiterals("Show '{name}' and '{{x}}' but {real}")).toEqual(["{name}", "{{x}}"]);
  });
  it("returns nothing when there are no literal spans", () => {
    expect(extractLiterals("no literals {here}")).toEqual([]);
  });
});

describe("toLaravel", () => {
  it("converts {name} to :name", () => {
    expect(toLaravel("Hello {name}")).toBe("Hello :name");
  });
  it("passes ICU plural through unchanged", () => {
    const s = "{count, plural, one {# item} other {# items}}";
    expect(toLaravel(s)).toBe(s);
  });
  it("emits an ICU-quoted span as a literal — quotes stripped, not converted to :name", () => {
    expect(toLaravel("Hello '{name}'")).toBe("Hello {name}");
    expect(toLaravel("Hello '{{name}}'")).toBe("Hello {{name}}");
    expect(toLaravel("Dear {visitor}, see '{site}'")).toBe("Dear :visitor, see {site}");
  });
});

describe("toI18next", () => {
  it("converts {name} to {{name}}", () => {
    expect(toI18next("Hello {name}")).toBe("Hello {{name}}");
  });
  it("converts a count token in a plural form body", () => {
    expect(toI18next("{count} item")).toBe("{{count}} item");
  });
  it("does not double-wrap an already double-braced token", () => {
    expect(toI18next("Hello {{name}}")).toBe("Hello {{name}}");
  });
  it("passes ICU plural/select through unchanged", () => {
    const s = "{count, plural, one {# item} other {# items}}";
    expect(toI18next(s)).toBe(s);
  });
  it("emits an ICU-quoted span as a literal without wrapping", () => {
    expect(toI18next("Show '{name}' but use {real}")).toBe("Show {name} but use {{real}}");
  });
});

describe("toRuby", () => {
  it("converts {name} to %{name}", () => {
    expect(toRuby("Hello {name}")).toBe("Hello %{name}");
    expect(toRuby("{count} items in {place}")).toBe("%{count} items in %{place}");
  });
  it("leaves ICU plural/select untouched", () => {
    const s = "{count, plural, one {# item} other {# items}}";
    expect(toRuby(s)).toBe(s);
  });
  it("does not double-prefix a token already in Ruby form", () => {
    expect(toRuby("%{name} leads")).toBe("%{name} leads");
  });
  it("emits an ICU-quoted span as a literal without prefixing", () => {
    expect(toRuby("Show '{name}' but use {real}")).toBe("Show {name} but use %{real}");
  });
});

describe("isIcuPluralOrSelect", () => {
  it("detects plural/select", () => {
    expect(isIcuPluralOrSelect("{n, plural, other {x}}")).toBe(true);
    expect(isIcuPluralOrSelect("{g, select, other {x}}")).toBe(true);
    expect(isIcuPluralOrSelect("Hi {name}")).toBe(false);
  });
});

describe("placeholdersMatch", () => {
  it("is true when source and translation share the same placeholder set", () => {
    expect(placeholdersMatch("Hi {name}", "Bonjour {name}")).toBe(true);
    expect(placeholdersMatch("Hi {name}", "Bonjour")).toBe(false);
  });
});

describe("placeholdersSubset", () => {
  it("is true when the translation introduces no placeholder absent from the source", () => {
    expect(placeholdersSubset("You have {count} files", "You have {count} files")).toBe(true);
    expect(placeholdersSubset("You have {count} files", "No files")).toBe(true);
  });
  it("is false when the translation adds a placeholder not in the source", () => {
    expect(placeholdersSubset("You have {count} files", "You have {count} {bogus} files")).toBe(false);
    expect(placeholdersSubset("No files", "{count} files")).toBe(false);
  });
});
