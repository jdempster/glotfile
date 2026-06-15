import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { flutterArb } from "./flutter-arb.js";

const FIXTURE = resolve("test/fixtures/import/arb/lib/l10n");

describe("flutterArb parser", () => {
  it("parses both arb files, skips @ metadata keys", () => {
    const result = flutterArb.parse(FIXTURE);
    expect(result.locales.sort()).toEqual(["en", "fr"]);
    expect(result.keys["signIn"]?.values["en"]).toBe("Sign in");
    expect(result.keys["signIn"]?.values["fr"]).toBe("Se connecter");
    expect(Object.keys(result.keys)).not.toContain("@@locale");
    expect(Object.keys(result.keys)).not.toContain("@signIn");
    expect(result.warnings).toHaveLength(0);
  });

  it("filters locales when opts.locales is given", () => {
    const result = flutterArb.parse(FIXTURE, { locales: ["en"] });
    expect(result.locales).toEqual(["en"]);
    expect(result.keys["signIn"]?.values["fr"]).toBeUndefined();
  });

  it("captures @key placeholder metadata", () => {
    const result = flutterArb.parse(FIXTURE);
    expect(result.keys["welcome"]?.placeholders).toEqual({ name: { type: "String", example: "Sam" } });
    // signIn has only a description (no placeholders) → none captured.
    expect(result.keys["signIn"]?.placeholders).toBeUndefined();
  });
});
