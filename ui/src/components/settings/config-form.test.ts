import { describe, it, expect } from "vitest";
import { configToForm, formToConfig } from "./config-form.js";
import type { Config } from "@/types.js";

const config: Config = {
  sourceLocale: "en",
  locales: ["en", "fr", "de"],
  outputs: [
    // emptyAs reflects the per-adapter default configToForm normalises to
    // (ARB omits untranslated keys; Laravel/Vue fill from source).
    { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb", emptyAs: "omit" },
    { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php", emptyAs: "source" },
  ],
  format: { indent: 2, sortKeys: true, finalNewline: true },
  autoExport: true,
  spelling: { customWords: ["Glotfile"] },
};

describe("config-form", () => {
  it("round-trips a config through form and back", () => {
    expect(formToConfig(configToForm(config))).toEqual(config);
  });

  it("defaults a missing includeLocale to on in the form (@@locale is standard for Flutter)", () => {
    expect(configToForm(config).outputs[0]!.includeLocale).toBe(true);
  });

  it("persists includeLocale only when off, since on is the default", () => {
    const form = configToForm(config);
    // On (the default) is omitted from the saved config...
    expect(formToConfig(form).outputs[0]!.includeLocale).toBeUndefined();
    // ...while explicitly turning it off is written through.
    form.outputs[0]!.includeLocale = false;
    expect(formToConfig(form).outputs[0]!.includeLocale).toBe(false);
  });

  it("round-trips skipSourceLocale so a Settings save doesn't wipe it", () => {
    const withSkip = structuredClone(config);
    withSkip.outputs[0]!.skipSourceLocale = true;
    expect(formToConfig(configToForm(withSkip))).toEqual(withSkip);
    // Off (the default) stays omitted.
    expect(formToConfig(configToForm(config)).outputs[0]!.skipSourceLocale).toBeUndefined();
  });

  it("coerces a numeric string indent to a number", () => {
    const form = configToForm(config);
    form.indent = "4";
    expect(formToConfig(form).format.indent).toBe(4);
  });

  it("falls back to the default indent for non-numeric input", () => {
    const form = configToForm(config);
    form.indent = "";
    expect(formToConfig(form).format.indent).toBe(2);
  });

  it("drops fully-blank output rows", () => {
    const form = configToForm(config);
    form.outputs.push({ adapter: "", path: "" });
    form.outputs.push({ adapter: " ", path: "  " });
    expect(formToConfig(form).outputs).toHaveLength(2);
  });

  it("round-trips a non-empty exportLocales limit", () => {
    const limited: Config = { ...config, exportLocales: ["en", "fr"] };
    expect(formToConfig(configToForm(limited))).toEqual(limited);
  });

  it("reads exportLocales into the form", () => {
    expect(configToForm({ ...config, exportLocales: ["en"] }).exportLocales).toEqual(["en"]);
  });

  it("omits exportLocales from the config when the limit is empty", () => {
    expect(configToForm(config).exportLocales).toEqual([]);
    expect(formToConfig(configToForm(config))).not.toHaveProperty("exportLocales");
  });

  it("round-trips a config.scan block", () => {
    const scanned: Config = {
      ...config,
      scan: {
        accessors: ["translations", "loc"],
        patterns: ["LocaleKeys\\.(\\w+)\\.tr\\(\\)"],
        include: ["lib/**"],
        exclude: ["**/*.g.dart"],
        keep: ["auth.throttle", "validation.*"],
      },
    };
    expect(formToConfig(configToForm(scanned))).toEqual(scanned);
  });

  it("reads config.scan fields into the form", () => {
    const form = configToForm({ ...config, scan: { accessors: ["loc"] } });
    expect(form.scanAccessors).toEqual(["loc"]);
    expect(form.scanPatterns).toEqual([]);
    expect(form.scanInclude).toEqual([]);
    expect(form.scanExclude).toEqual([]);
    expect(form.scanKeep).toEqual([]);
  });

  it("omits scan from the config when every scan field is empty", () => {
    expect(formToConfig(configToForm(config))).not.toHaveProperty("scan");
  });

  it("reads lint rule overrides into the form on top of defaults", () => {
    const form = configToForm({ ...config, lint: { rules: { spelling: "off", "max-length": "error" } } });
    expect(form.lintRules["spelling"]).toBe("off");
    expect(form.lintRules["max-length"]).toBe("error");
    // Untouched rules show their built-in default.
    expect(form.lintRules["identical-to-source"]).toBe("warn");
    expect(form.lintRules["placeholder-mismatch"]).toBe("error");
  });

  it("persists only the rule severities that differ from the defaults", () => {
    const form = configToForm(config);
    form.lintRules["spelling"] = "off";
    const result = formToConfig(form);
    expect(result.lint).toEqual({ rules: { spelling: "off" } });
  });

  it("omits lint entirely when everything matches the defaults", () => {
    expect(formToConfig(configToForm(config))).not.toHaveProperty("lint");
  });

  it("round-trips lint ignore globs", () => {
    const withLint: Config = { ...config, lint: { ignore: ["legacy.*"] } };
    expect(formToConfig(configToForm(withLint))).toEqual(withLint);
  });

  it("preserves unmodeled lint.spelling locale overrides across a save", () => {
    const withLint: Config = { ...config, lint: { spelling: { locales: { en: "en-US" } } } };
    const result = formToConfig(configToForm(withLint), withLint);
    expect(result.lint).toEqual({ spelling: { locales: { en: "en-US" } } });
  });

  it("preserves config.storage (not modeled by the form) across a round-trip", () => {
    const original: Config = { ...config, storage: "split" as const };
    const result = formToConfig(configToForm(original), original);
    expect(result.storage).toBe("split");
  });

  it("leaves storage undefined when there is no original (fresh config)", () => {
    const original: Config = { ...config, storage: "split" as const };
    // No `original` arg => the form cannot know about storage, so it's absent.
    expect(formToConfig(configToForm(original)).storage).toBeUndefined();
  });

  it("preserves EVERY populated Config section across a save (completeness guard)", () => {
    // A new top-level config.* field added to the schema must be either modeled by
    // ConfigForm or carried through `original`. If it isn't, it drops out here.
    // Keep this fixture exhaustive: every key of Config must be populated.
    const full: Config = {
      sourceLocale: "en",
      locales: ["en", "fr"],
      outputs: [{ adapter: "flutter-arb", path: "app_{locale}.arb", emptyAs: "omit" }],
      format: { indent: 4, sortKeys: false, finalNewline: false },
      autoExport: false,
      exportLocales: ["en", "fr"],
      spelling: { customWords: ["Glotfile"] },
      scan: { accessors: ["t"], patterns: ["x"], include: ["src/**"], exclude: ["dist/**"], keep: ["keep.*"] },
      lint: { rules: { spelling: "off" }, ignore: ["a.*"], spelling: { locales: { en: "en-US" } } },
      storage: "split",
    };
    // Tripwire: the fixture must cover the whole Config surface, so the round-trip
    // below actually exercises every section. Update both when a field is added.
    expect(Object.keys(full).sort()).toEqual(
      ["autoExport", "exportLocales", "format", "lint", "locales", "outputs", "scan", "sourceLocale", "spelling", "storage"],
    );
    const result = formToConfig(configToForm(full), full);
    expect(Object.keys(result).sort()).toEqual(Object.keys(full).sort());
    expect(result).toEqual(full);
  });

  it("round-trips localeCase and localeMap on an output", () => {
    const withLocale: Config = {
      ...config,
      outputs: [
        { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb", emptyAs: "omit", localeCase: "bcp47-hyphen", localeMap: { fr: "fr_FR" } },
        { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php", emptyAs: "source" },
      ],
    };
    expect(formToConfig(configToForm(withLocale))).toEqual(withLocale);
  });

  it("normalises a missing localeMap to an empty object in the form", () => {
    expect(configToForm(config).outputs[0]!.localeMap).toEqual({});
    expect(configToForm(config).outputs[0]!.localeCase).toBeUndefined();
  });

  it("omits localeCase from the config when unset", () => {
    const out = formToConfig(configToForm(config)).outputs[0]!;
    expect(out).not.toHaveProperty("localeCase");
  });

  it("drops empty-value localeMap entries and omits an all-empty map", () => {
    const form = configToForm(config);
    form.outputs[0]!.localeMap = { fr: "", de: "de_DE" };
    form.outputs[1]!.localeMap = { fr: "  " };
    const result = formToConfig(form);
    expect(result.outputs[0]!.localeMap).toEqual({ de: "de_DE" });
    expect(result.outputs[1]!).not.toHaveProperty("localeMap");
  });
});
