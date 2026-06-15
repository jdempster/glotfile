import { describe, it, expect } from "vitest";
import { defaultState } from "../schema.js";
import { createKey } from "../state.js";
import { resolveFormat, resolveEmptyAs, resolveScalar, resolveForms, applyCase, resolveLocaleToken, inferLocaleStyle } from "./options.js";

describe("resolveFormat", () => {
  it("falls back to global format, output overrides win", () => {
    const s = defaultState();
    s.config.format = { indent: 2, sortKeys: true, finalNewline: true };
    expect(resolveFormat(s, { adapter: "x", path: "y" })).toEqual({ indent: 2, finalNewline: true });
    expect(resolveFormat(s, { adapter: "x", path: "y", indent: 4, finalNewline: false })).toEqual({ indent: 4, finalNewline: false });
  });
});

describe("resolveEmptyAs", () => {
  it("uses the output value, else the adapter default", () => {
    expect(resolveEmptyAs({ adapter: "x", path: "y" }, "omit")).toBe("omit");
    expect(resolveEmptyAs({ adapter: "x", path: "y", emptyAs: "source" }, "omit")).toBe("source");
  });
});

describe("resolveScalar", () => {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  createKey(s, "k", "Hello");
  const entry = s.keys["k"]!;

  it("source locale always writes its own value", () => {
    expect(resolveScalar(entry, "en", "en", "omit")).toBe("Hello");
  });
  it("omit drops an empty target", () => {
    expect(resolveScalar(entry, "fr", "en", "omit")).toBeNull();
  });
  it("empty writes an empty string", () => {
    expect(resolveScalar(entry, "fr", "en", "empty")).toBe("");
  });
  it("source fills an empty target from the source value", () => {
    expect(resolveScalar(entry, "fr", "en", "source")).toBe("Hello");
  });
  it("a present target value is returned regardless of mode", () => {
    entry.values["fr"] = { value: "Bonjour", state: "reviewed" };
    expect(resolveScalar(entry, "fr", "en", "omit")).toBe("Bonjour");
  });
});

describe("resolveForms", () => {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  createKey(s, "p", "{n} items", undefined, { plural: { arg: "n" } });
  const entry = s.keys["p"]!;
  entry.values["en"]!.forms = { one: "{n} item", other: "{n} items" };

  it("omit drops a target with no other form", () => {
    expect(resolveForms(entry, "fr", "en", "omit")).toBeNull();
  });
  it("source fills from the source forms", () => {
    expect(resolveForms(entry, "fr", "en", "source")).toEqual({ one: "{n} item", other: "{n} items" });
  });
});

describe("applyCase", () => {
  it("bcp47-underscore reproduces the old flutterLocale output", () => {
    expect(applyCase("en", "bcp47-underscore")).toBe("en");
    expect(applyCase("en-us", "bcp47-underscore")).toBe("en_US");
    expect(applyCase("ca-es", "bcp47-underscore")).toBe("ca_ES");
    expect(applyCase("zh-hant-tw", "bcp47-underscore")).toBe("zh_Hant_TW");
    expect(applyCase("es-419", "bcp47-underscore")).toBe("es_419");
  });
  it("bcp47-hyphen uses hyphens with BCP-47 casing", () => {
    expect(applyCase("en-us", "bcp47-hyphen")).toBe("en-US");
    expect(applyCase("zh-hant-tw", "bcp47-hyphen")).toBe("zh-Hant-TW");
  });
  it("lower-hyphen and lower-underscore only change separators/case", () => {
    expect(applyCase("en-us", "lower-hyphen")).toBe("en-us");
    expect(applyCase("zh-hant-tw", "lower-hyphen")).toBe("zh-hant-tw");
    expect(applyCase("en-us", "lower-underscore")).toBe("en_us");
  });
  it("normalizes mixed-case / mixed-separator input", () => {
    expect(applyCase("EN_us", "bcp47-underscore")).toBe("en_US");
    expect(applyCase("zh-Hans", "bcp47-underscore")).toBe("zh_Hans");
  });
});

describe("resolveLocaleToken", () => {
  it("localeMap entry wins verbatim over case", () => {
    const out = { adapter: "x", path: "y", localeCase: "lower-hyphen" as const, localeMap: { "zh-hant": "zh_HK" } };
    expect(resolveLocaleToken(out, "zh-hant", "bcp47-underscore")).toBe("zh_HK");
  });
  it("falls back to output.localeCase when no map entry", () => {
    expect(resolveLocaleToken({ adapter: "x", path: "y", localeCase: "bcp47-hyphen" }, "en-us", "lower-hyphen")).toBe("en-US");
  });
  it("falls back to the adapter default when neither is set", () => {
    expect(resolveLocaleToken({ adapter: "x", path: "y" }, "en-us", "bcp47-underscore")).toBe("en_US");
  });
});

describe("inferLocaleStyle", () => {
  it("returns empty when every observed token matches the adapter default", () => {
    const pairs: [string, string][] = [["en", "en"], ["en-us", "en_US"], ["zh-hant-tw", "zh_Hant_TW"]];
    expect(inferLocaleStyle(pairs, "bcp47-underscore")).toEqual({});
  });
  it("picks the blanket style that reproduces the most tokens", () => {
    const pairs: [string, string][] = [["de-de", "de_DE"], ["fr-fr", "fr_FR"]];
    expect(inferLocaleStyle(pairs, "lower-hyphen")).toEqual({ localeCase: "bcp47-underscore" });
  });
  it("records outliers in localeMap after choosing the dominant style", () => {
    const pairs: [string, string][] = [["en-us", "en-US"], ["fr-fr", "fr-FR"], ["zh-hk", "zh-rHK"]];
    expect(inferLocaleStyle(pairs, "lower-hyphen")).toEqual({
      localeCase: "bcp47-hyphen",
      localeMap: { "zh-hk": "zh-rHK" },
    });
  });
  it("prefers the adapter default on a tie", () => {
    expect(inferLocaleStyle([["en", "en"]], "lower-hyphen")).toEqual({});
  });
  it("emits only localeMap when the default style already matches the majority", () => {
    // adapterDefault bcp47-underscore matches en_US/de_DE; the Android-style token matches no style.
    const pairs: [string, string][] = [["en-us", "en_US"], ["de-de", "de_DE"], ["zh-cn", "zh-rCN"]];
    expect(inferLocaleStyle(pairs, "bcp47-underscore")).toEqual({ localeMap: { "zh-cn": "zh-rCN" } });
  });
  it("can choose lower-underscore as the winning style", () => {
    expect(inferLocaleStyle([["en-us", "en_us"]], "bcp47-underscore")).toEqual({ localeCase: "lower-underscore" });
  });
});
