import { describe, it, expect } from "vitest";
import { appleStrings } from "./apple-strings.js";
import { defaultState } from "../schema.js";
import { createKey, setTargetValue } from "../state.js";

function fixture() {
  const s = defaultState();
  s.config.sourceLocale = "en";
  s.config.locales = ["en", "fr", "zh-hans"];
  createKey(s, "Tap to start", "Tap to start");
  setTargetValue(s, "Tap to start", "fr", "Appuyez pour commencer");
  createKey(s, "Quotes \"here\"", "Quotes \"here\"");
  createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
  s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
  return s;
}

describe("apple-strings", () => {
  it("writes one .strings file per locale at the .lproj path with BCP-47 casing", () => {
    const r = appleStrings.export(fixture(), { adapter: "apple-strings", path: "{locale}.lproj/Localizable.strings" });
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "en.lproj/Localizable.strings",
      "fr.lproj/Localizable.strings",
      "zh-Hans.lproj/Localizable.strings",
    ]);
  });

  it("emits scalar keys as \"key\" = \"value\"; and escapes quotes", () => {
    const r = appleStrings.export(fixture(), { adapter: "apple-strings", path: "{locale}.lproj/Localizable.strings" });
    const en = r.files.find((f) => f.path === "en.lproj/Localizable.strings")!.contents;
    expect(en).toContain('"Tap to start" = "Tap to start";');
    expect(en).toContain('"Quotes \\"here\\"" = "Quotes \\"here\\"";');
  });

  it("skips plural keys (those belong in .stringsdict)", () => {
    const r = appleStrings.export(fixture(), { adapter: "apple-strings", path: "{locale}.lproj/Localizable.strings" });
    const en = r.files.find((f) => f.path === "en.lproj/Localizable.strings")!.contents;
    expect(en).not.toContain("cart.items");
  });

  it("falls back to the source value for untranslated targets by default", () => {
    const r = appleStrings.export(fixture(), { adapter: "apple-strings", path: "{locale}.lproj/Localizable.strings" });
    const fr = r.files.find((f) => f.path === "fr.lproj/Localizable.strings")!.contents;
    expect(fr).toContain('"Tap to start" = "Appuyez pour commencer";');
    expect(fr).toContain('"Quotes \\"here\\"" = "Quotes \\"here\\"";');
  });

  it("strips literal-span apostrophes and escapes literal % as %%", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "promo", "See '{site}' for 50% off");
    const r = appleStrings.export(s, { adapter: "apple-strings", path: "{locale}.lproj/Localizable.strings" });
    const en = r.files.find((f) => f.path === "en.lproj/Localizable.strings")!.contents;
    expect(en).toContain('"promo" = "See {site} for 50%% off";');
  });

  it("re-export is byte-identical", () => {
    const a = appleStrings.export(fixture(), { adapter: "apple-strings", path: "{locale}.lproj/Localizable.strings" });
    const b = appleStrings.export(fixture(), { adapter: "apple-strings", path: "{locale}.lproj/Localizable.strings" });
    expect(a.files).toEqual(b.files);
  });
});
