import { describe, it, expect } from "vitest";
import { validate, defaultState, GlotfileError } from "./schema.js";

function withConfig(lint: unknown) {
  return {
    version: 1,
    config: {
      sourceLocale: "en",
      locales: ["en", "fr"],
      outputs: [{ adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" }],
      ai: { provider: "anthropic", model: "claude-opus-4-8", endpoint: null, batchSize: 25 },
      format: { indent: 2, sortKeys: true, finalNewline: true },
      lint,
    },
    glossary: [],
    keys: {},
  };
}

describe("validate", () => {
  it("accepts a minimal valid state and fills nothing it shouldn't", () => {
    const s = validate({
      version: 1,
      config: {
        sourceLocale: "en",
        locales: ["en", "fr"],
        outputs: [{ adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb" }],
        ai: { provider: "anthropic", model: "claude-opus-4-8", endpoint: null, batchSize: 25 },
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      keys: {
        "auth.signIn": { values: { en: { value: "Sign in", state: "source" } } },
      },
    });
    expect(s.config.sourceLocale).toBe("en");
    expect(s.keys["auth.signIn"]!.values.en!.state).toBe("source");
  });

  it("throws GlotfileError on a non-object root", () => {
    expect(() => validate(null)).toThrow(GlotfileError);
    expect(() => validate("x")).toThrow(/must be a JSON object/);
  });

  it("throws when sourceLocale is missing from locales", () => {
    expect(() =>
      validate({
        version: 1,
        config: {
          sourceLocale: "de",
          locales: ["en", "fr"],
          outputs: [],
          ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
          format: { indent: 2, sortKeys: true, finalNewline: true },
        },
        glossary: [],
        keys: {},
      }),
    ).toThrow(/sourceLocale "de" is not in config.locales/);
  });

  it("rejects an invalid locale state", () => {
    expect(() =>
      validate({
        version: 1,
        config: {
          sourceLocale: "en",
          locales: ["en"],
          outputs: [],
          ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
          format: { indent: 2, sortKeys: true, finalNewline: true },
        },
        glossary: [],
        keys: { k: { values: { en: { value: "v", state: "bogus" } } } },
      }),
    ).toThrow(/invalid state "bogus"/);
  });

  it("accepts scan.keep globs and rejects a non-string-array scan.keep", () => {
    const base = {
      version: 1,
      config: {
        sourceLocale: "en",
        locales: ["en"],
        outputs: [],
        ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      keys: {},
    };
    const ok = validate({ ...base, config: { ...base.config, scan: { keep: ["auth.throttle", "validation.*"] } } });
    expect(ok.config.scan?.keep).toEqual(["auth.throttle", "validation.*"]);
    expect(() =>
      validate({ ...base, config: { ...base.config, scan: { keep: "auth.throttle" } } }),
    ).toThrow(/config.scan.keep must be an array of strings/);
  });

  it("rejects a non-number version", () => {
    expect(() =>
      validate({
        version: "1",
        config: {
          sourceLocale: "en",
          locales: ["en"],
          outputs: [],
          ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
          format: { indent: 2, sortKeys: true, finalNewline: true },
        },
        glossary: [],
        keys: {},
      }),
    ).toThrow(/version must be a number/);
  });

  it("rejects a non-number config.format.indent", () => {
    expect(() =>
      validate({
        version: 1,
        config: {
          sourceLocale: "en",
          locales: ["en"],
          outputs: [],
          ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
          format: { indent: "x", sortKeys: true, finalNewline: true },
        },
        glossary: [],
        keys: {},
      }),
    ).toThrow(/indent must be a number/);
  });

  it("accepts a valid notes array", () => {
    const s = validate({
      version: 1,
      config: {
        sourceLocale: "en",
        locales: ["en"],
        outputs: [],
        ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      keys: {
        k: {
          notes: [{ id: "n_1", text: "hi", at: "2026-01-01T00:00:00Z" }],
          values: { en: { value: "v", state: "source" } },
        },
      },
    });
    expect(s.keys["k"]!.notes![0]!.text).toBe("hi");
  });

  it("rejects a note missing string fields", () => {
    expect(() =>
      validate({
        version: 1,
        config: {
          sourceLocale: "en",
          locales: ["en"],
          outputs: [],
          ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
          format: { indent: 2, sortKeys: true, finalNewline: true },
        },
        glossary: [],
        keys: {
          k: {
            notes: [{ id: "n_1", text: 123, at: "2026-01-01T00:00:00Z" }],
            values: { en: { value: "v", state: "source" } },
          },
        },
      }),
    ).toThrow(/invalid note/i);
  });

  it("accepts a valid plural key", () => {
    const s = validate({
      version: 2,
      config: {
        sourceLocale: "en",
        locales: ["en", "pl"],
        outputs: [],
        ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      keys: {
        "cart.items": {
          plural: { arg: "count" },
          values: {
            en: { forms: { one: "{count} item", other: "{count} items" }, state: "source" },
            pl: { forms: { one: "{count} produkt", few: "{count} produkty", many: "{count} produktów", other: "{count} produktu" }, state: "reviewed" },
          },
        },
      },
    });
    expect(s.keys["cart.items"]!.plural!.arg).toBe("count");
    expect(s.keys["cart.items"]!.values.en!.forms!.other).toBe("{count} items");
  });

  it("rejects a plural value missing the 'other' form", () => {
    expect(() =>
      validate({
        version: 2,
        config: {
          sourceLocale: "en", locales: ["en"], outputs: [],
          ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
          format: { indent: 2, sortKeys: true, finalNewline: true },
        },
        glossary: [],
        keys: { "k": { plural: { arg: "count" }, values: { en: { forms: { one: "x" }, state: "source" } } } },
      }),
    ).toThrow(/must include the "other" form/);
  });

  it("rejects an unknown plural category", () => {
    expect(() =>
      validate({
        version: 2,
        config: {
          sourceLocale: "en", locales: ["en"], outputs: [],
          ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
          format: { indent: 2, sortKeys: true, finalNewline: true },
        },
        glossary: [],
        keys: { "k": { plural: { arg: "count" }, values: { en: { forms: { other: "x", lots: "y" }, state: "source" } } } },
      }),
    ).toThrow(/invalid plural category "lots"/);
  });

  it("accepts exact (=N) plural selectors alongside categories", () => {
    const s = validate({
      version: 2,
      config: {
        sourceLocale: "en", locales: ["en"], outputs: [],
        ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      keys: { "k": { plural: { arg: "count" }, values: { en: { forms: { "=1": "one thing", other: "many things" }, state: "source" } } } },
    });
    expect(s.keys["k"]!.values.en!.forms!["=1"]).toBe("one thing");
  });

  it("rejects plural.arg that is not a non-empty string", () => {
    expect(() =>
      validate({
        version: 2,
        config: {
          sourceLocale: "en", locales: ["en"], outputs: [],
          ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
          format: { indent: 2, sortKeys: true, finalNewline: true },
        },
        glossary: [],
        keys: { "k": { plural: { arg: "" }, values: { en: { forms: { other: "x" }, state: "source" } } } },
      }),
    ).toThrow(/plural.arg must be a non-empty string/);
  });

  it("accepts a valid config.lint block", () => {
    const s = validate(withConfig({
      rules: { "max-length": "error", "spelling": "off" },
      ignore: ["legacy.*"],
      spelling: { locales: { en: "en-US" } },
    }));
    expect(s.config.lint?.rules?.["max-length"]).toBe("error");
  });
  it("accepts state with no config.lint", () => {
    expect(() => validate(withConfig(undefined))).not.toThrow();
  });
  it("rejects an unknown lint rule id", () => {
    expect(() => validate(withConfig({ rules: { "no-such-rule": "error" } })))
      .toThrow(/unknown rule id "no-such-rule"/);
  });
  it("rejects an invalid severity", () => {
    expect(() => validate(withConfig({ rules: { "max-length": "loud" } })))
      .toThrow(/must be "error", "warn", or "off"/);
  });
  it("rejects a non-string ignore entry", () => {
    expect(() => validate(withConfig({ ignore: [123] })))
      .toThrow(/config.lint.ignore must be an array of strings/);
  });
});

describe("defaultState", () => {
  it("seeds flutter+laravel outputs (AI now lives in local settings, not committed config)", () => {
    const s = defaultState();
    expect(s.config.outputs.map((o) => o.adapter)).toEqual(["flutter-arb", "laravel-php"]);
    expect(s.config.sourceLocale).toBe("en");
    expect(s.config.locales).toEqual(["en"]);
    expect(s.config).not.toHaveProperty("ai");
    expect(() => validate(s)).not.toThrow();
  });
});

describe("contextSource field", () => {
  function keyState(key: object) {
    return {
      version: 1,
      config: {
        sourceLocale: "en", locales: ["en"],
        outputs: [], ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 1 },
        format: { indent: 2, sortKeys: true, finalNewline: true },
      },
      glossary: [],
      keys: { k: { ...key, values: { en: { value: "v", state: "source" } } } },
    };
  }

  it("accepts contextSource: 'ai'", () => {
    const s = validate(keyState({ contextSource: "ai" }));
    expect(s.keys["k"]!.contextSource).toBe("ai");
  });

  it("rejects contextSource that is not 'ai'", () => {
    expect(() => validate(keyState({ contextSource: "human" }))).toThrow(/contextSource/i);
  });

  it("accepts a key with no contextSource (human-authored context)", () => {
    const s = validate(keyState({ context: "A login button" }));
    expect(s.keys["k"]!.context).toBe("A login button");
    expect(s.keys["k"]!.contextSource).toBeUndefined();
  });
});

describe("per-output export options", () => {
  it("accepts emptyAs/indent/finalNewline/includeLocale/localeAliases", () => {
    const s = defaultState();
    s.config.outputs = [
      { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php", emptyAs: "source", indent: 4, finalNewline: true },
      { adapter: "flutter-arb", path: "lib/l10n/app_{locale}.arb", includeLocale: false, finalNewline: false, localeAliases: { "zh-Hans": ["zh", "zh_CN"] } },
    ];
    expect(() => validate(s)).not.toThrow();
  });

  it("rejects an invalid emptyAs value", () => {
    const s = defaultState();
    s.config.outputs = [{ adapter: "laravel-php", path: "x", emptyAs: "nope" } as unknown as never];
    expect(() => validate(s)).toThrow(/emptyAs/);
  });

  it("rejects a non-number output indent", () => {
    const s = defaultState();
    s.config.outputs = [{ adapter: "laravel-php", path: "x", indent: "4" } as unknown as never];
    expect(() => validate(s)).toThrow(/indent/);
  });

  it("rejects malformed localeAliases", () => {
    const s = defaultState();
    s.config.outputs = [{ adapter: "flutter-arb", path: "x", localeAliases: { a: "b" } } as unknown as never];
    expect(() => validate(s)).toThrow(/localeAliases/);
  });
});

describe("config.exportLocales", () => {
  it("accepts an array of locale strings", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    s.config.exportLocales = ["en"];
    expect(() => validate(s)).not.toThrow();
    expect(validate(s).config.exportLocales).toEqual(["en"]);
  });

  it("accepts state with no exportLocales (backward compatible)", () => {
    const s = defaultState();
    expect(() => validate(s)).not.toThrow();
    expect(validate(s).config.exportLocales).toBeUndefined();
  });

  it("rejects a non-array exportLocales", () => {
    const s = defaultState();
    s.config.exportLocales = "en" as unknown as string[];
    expect(() => validate(s)).toThrow(/exportLocales must be an array of strings/);
  });

  it("rejects a non-string entry", () => {
    const s = defaultState();
    s.config.exportLocales = ["en", 5] as unknown as string[];
    expect(() => validate(s)).toThrow(/exportLocales must be an array of strings/);
  });
});

describe("key placeholder metadata", () => {
  it("accepts valid placeholder metadata", () => {
    const s = defaultState();
    s.keys["k"] = { values: { en: { value: "Hi {count}", state: "source" } }, placeholders: { count: { type: "num", format: "compact", example: "3" } } } as never;
    expect(() => validate(s)).not.toThrow();
  });

  it("rejects a non-string placeholder field", () => {
    const s = defaultState();
    s.keys["k"] = { values: { en: { value: "Hi", state: "source" } }, placeholders: { count: { type: 5 } } } as never;
    expect(() => validate(s)).toThrow(/placeholder/);
  });
});

function stateWithOutput(output: Record<string, unknown>) {
  const s = defaultState();
  s.config.locales = ["en", "zh-hant"];
  s.config.outputs = [output as never];
  return s;
}

function baseRaw() {
  return {
    version: 1,
    config: {
      sourceLocale: "en",
      locales: ["en"],
      outputs: [],
      ai: { provider: "anthropic", model: "m", endpoint: null, batchSize: 25 },
      format: { indent: 2, sortKeys: true, finalNewline: true },
    },
    glossary: [],
    keys: {},
  };
}

describe("config.storage", () => {
  it("accepts 'single' and 'split'", () => {
    for (const storage of ["single", "split"] as const) {
      const raw = baseRaw();
      (raw.config as Record<string, unknown>).storage = storage;
      expect(validate(raw).config.storage).toBe(storage);
    }
  });

  it("rejects any other value", () => {
    const raw = baseRaw();
    (raw.config as Record<string, unknown>).storage = "bogus";
    expect(() => validate(raw)).toThrow(GlotfileError);
  });

  it("defaults to undefined (single) for a fresh project", () => {
    expect(defaultState().config.storage).toBeUndefined();
  });
});

describe("OutputConfig localeCase/localeMap validation", () => {
  it("accepts a valid localeCase + localeMap subset of locales", () => {
    const s = stateWithOutput({ adapter: "flutter-arb", path: "app_{locale}.arb", localeCase: "bcp47-hyphen", localeMap: { "zh-hant": "zh_HK" } });
    expect(() => validate(s)).not.toThrow();
  });

  it("rejects an unknown localeCase value", () => {
    const s = stateWithOutput({ adapter: "flutter-arb", path: "app_{locale}.arb", localeCase: "PascalCase" });
    expect(() => validate(s)).toThrow(GlotfileError);
  });

  it("rejects a non-string localeMap value", () => {
    const s = stateWithOutput({ adapter: "flutter-arb", path: "app_{locale}.arb", localeMap: { "zh-hant": 5 } });
    expect(() => validate(s)).toThrow(GlotfileError);
  });

  it("rejects a localeMap key not present in locales", () => {
    const s = stateWithOutput({ adapter: "flutter-arb", path: "app_{locale}.arb", localeMap: { "de-de": "de_DE" } });
    expect(() => validate(s)).toThrow(/de-de/);
  });

  it("accepts a localeMap key written with underscores matching a hyphen locale", () => {
    const s = stateWithOutput({ adapter: "flutter-arb", path: "app_{locale}.arb", localeMap: { "zh_hant": "zh_HK" } });
    expect(() => validate(s)).not.toThrow();
  });
});
