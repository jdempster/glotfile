import { describe, it, expect } from "vitest";
import { categoriesFor } from "./plurals.js";

describe("categoriesFor", () => {
  it("returns one/other for English", () => {
    expect(categoriesFor("en")).toEqual(["one", "other"]);
  });

  it("returns other only for Japanese", () => {
    expect(categoriesFor("ja")).toEqual(["other"]);
  });

  it("returns one/few/many/other in canonical order for Polish", () => {
    expect(categoriesFor("pl")).toEqual(["one", "few", "many", "other"]);
  });

  it("falls back to other for an unknown/invalid tag", () => {
    expect(categoriesFor("not-a-locale!!")).toEqual(["other"]);
  });

  it("normalizes underscore locale codes (en_us → one/other)", () => {
    expect(categoriesFor("en_us")).toEqual(["one", "other"]);
    expect(categoriesFor("pt_br")).toEqual(["one", "many", "other"]);
  });
});
