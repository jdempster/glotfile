import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { laravelPhp } from "./laravel-php.js";

const FIXTURE = resolve("test/fixtures/import/laravel/lang");

describe("laravelPhp parser", () => {
  it("parses both locale dirs, normalizes :name placeholders", () => {
    const result = laravelPhp.parse(FIXTURE);
    expect(result.locales.sort()).toEqual(["en", "fr"]);
    expect(result.keys["auth.sign_in"]?.values["en"]).toBe("Sign in");
    expect(result.keys["auth.sign_in"]?.values["fr"]).toBe("Se connecter");
    expect(result.keys["auth.welcome"]?.values["en"]).toBe("Welcome {name}");
    expect(result.keys["auth.welcome"]?.values["fr"]).toBe("Bienvenue {name}");
    expect(result.warnings).toHaveLength(0);
  });

  it("filters locales when opts.locales is given", () => {
    const result = laravelPhp.parse(FIXTURE, { locales: ["en"] });
    expect(result.locales).toEqual(["en"]);
    expect(result.keys["auth.sign_in"]?.values["fr"]).toBeUndefined();
  });
});
