import { describe, it, expect } from "vitest";
import { laravelPhp } from "./laravel-php.js";
import { defaultState } from "../schema.js";
import { createKey, setPluralForms } from "../state.js";

function fixture() {
  const s = defaultState();
  s.config.locales = ["en", "fr"];
  createKey(s, "auth.signIn.button", "Sign in {name}");
  s.keys["auth.signIn.button"]!.values.fr = { value: "Se connecter {name}", state: "reviewed" };
  createKey(s, "auth.logout", "Log out");
  createKey(s, "welcome", "Welcome");
  createKey(s, "items.count", "{count, plural, one {# item} other {# items}}");
  return s;
}

describe("laravel-php", () => {
  it("nests dotted inner keys into PHP arrays and converts placeholders", () => {
    const r = laravelPhp.export(fixture(), { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    const frAuth = r.files.find((f) => f.path === "lang/fr/auth.php")!;
    expect(frAuth.contents).toContain("<?php");
    expect(frAuth.contents).toContain("'signIn' => [");
    expect(frAuth.contents).toContain("'button' => 'Se connecter :name',");
    // auth.logout has no French value; default emptyAs is "omit" → it is dropped.
    expect(frAuth.contents).not.toContain("logout");
    const enAuth = r.files.find((f) => f.path === "lang/en/auth.php")!;
    expect(enAuth.contents).toContain("'logout' => 'Log out',");
  });

  it("fills empty targets from source when emptyAs is 'source'", () => {
    const r = laravelPhp.export(fixture(), { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php", emptyAs: "source" });
    const frAuth = r.files.find((f) => f.path === "lang/fr/auth.php")!;
    expect(frAuth.contents).toContain("'logout' => 'Log out',");
  });

  it("bare keys go to messages.php", () => {
    const r = laravelPhp.export(fixture(), { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    expect(r.files.some((f) => f.path === "lang/en/messages.php")).toBe(true);
    const msgs = r.files.find((f) => f.path === "lang/en/messages.php")!;
    expect(msgs.contents).toContain("'welcome' => 'Welcome',");
  });

  it("warns (structured) on ICU plural and writes it through unconverted", () => {
    const r = laravelPhp.export(fixture(), { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    expect(r.warnings.some((w) => w.key === "items.count" && w.code === "lossy-plural")).toBe(true);
    const items = r.files.find((f) => f.path === "lang/en/items.php")!;
    expect(items.contents).toContain("plural,");
  });

  it("escapes single quotes and backslashes", () => {
    const s = defaultState();
    createKey(s, "msg.q", "It's a \\ test");
    const r = laravelPhp.export(s, { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    expect(r.files[0]!.contents).toContain("'q' => 'It\\'s a \\\\ test'");
  });

  it("emits pipe-delimited plural string for a structured plural key", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    setPluralForms(s, "cart.items", "fr", { one: "{count} article", other: "{count} articles" });
    const r = laravelPhp.export(s, { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    const enCart = r.files.find((f) => f.path === "lang/en/cart.php")!;
    expect(enCart.contents).toContain("'items' => ':count item|:count items'");
    const frCart = r.files.find((f) => f.path === "lang/fr/cart.php")!;
    expect(frCart.contents).toContain("'items' => ':count article|:count articles'");
  });

  it("does not warn lossy-plural for a structured plural key", () => {
    const s = defaultState();
    createKey(s, "cart.items", "{count} items", undefined, { plural: { arg: "count" } });
    s.keys["cart.items"]!.values.en!.forms = { one: "{count} item", other: "{count} items" };
    const r = laravelPhp.export(s, { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    expect(r.warnings.some((w) => w.key === "cart.items")).toBe(false);
  });

  it("defaults region locales to bcp47-underscore dirs Laravel can load", () => {
    const s = defaultState();
    s.config.locales = ["en", "zh-hk", "fr"];
    createKey(s, "greeting", "Hello");
    s.keys["greeting"]!.values["zh-hk"] = { value: "你好", state: "reviewed" };
    s.keys["greeting"]!.values["fr"] = { value: "Bonjour", state: "reviewed" };
    const r = laravelPhp.export(s, { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    // region locale gains underscore + uppercase region; bare codes stay bare.
    expect(r.files.some((f) => f.path === "lang/zh_HK/messages.php")).toBe(true);
    expect(r.files.some((f) => f.path === "lang/fr/messages.php")).toBe(true);
    expect(r.files.some((f) => f.path.startsWith("lang/zh-hk/"))).toBe(false);
  });

  it("re-export is byte-identical", () => {
    const a = laravelPhp.export(fixture(), { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    const b = laravelPhp.export(fixture(), { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    expect(b.files).toEqual(a.files);
  });

  it("warns lossy-literal when a literal :name collides with a real placeholder", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "greet", "Hi {name}, type :name to insert it");
    const r = laravelPhp.export(s, { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    expect(r.warnings.some((w) => w.code === "lossy-literal" && w.key === "greet")).toBe(true);
  });

  it("does not warn for a :token that matches no placeholder", () => {
    const s = defaultState();
    s.config.locales = ["en"];
    createKey(s, "ok", "Ratio is 3:1 and {name} is here");
    const r = laravelPhp.export(s, { adapter: "laravel-php", path: "lang/{locale}/{namespace}.php" });
    expect(r.warnings.some((w) => w.code === "lossy-literal")).toBe(false);
  });
});

