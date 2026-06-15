import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findMissing, loadUsageCache, computeUsedKeys, type UsageCacheFile } from "./scan.js";
import { defaultState } from "./schema.js";
import { createKey } from "./state.js";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "glot-scan-"));
}

describe("findMissing", () => {
  it("lists key/locale pairs lacking a non-empty value (excluding source), sorted by key then locale", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr", "de"];
    createKey(s, "k1", "Hi");
    createKey(s, "k2", "Bye");
    s.keys["k1"]!.values.fr = { value: "Salut", state: "reviewed" };
    const missing = findMissing(s);
    expect(missing).toEqual([
      { key: "k1", locale: "de" },
      { key: "k2", locale: "de" },
      { key: "k2", locale: "fr" },
    ]);
  });

  it("treats a plural key as present when the target has a non-empty other form", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    s.keys["files"] = {
      plural: { arg: "count" },
      values: {
        en: { forms: { one: "{count} file", other: "{count} files" }, state: "source" },
        fr: { forms: { one: "{count} fichier", other: "{count} fichiers" }, state: "machine" },
      },
    };
    expect(findMissing(s)).toEqual([]);
  });

  it("flags a plural key whose target lacks an other form", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    s.keys["files"] = {
      plural: { arg: "count" },
      values: {
        en: { forms: { other: "{count} files" }, state: "source" },
        fr: { forms: { other: "" }, state: "machine" },
      },
    };
    expect(findMissing(s)).toEqual([{ key: "files", locale: "fr" }]);
  });

  it("skips skipTranslate keys", () => {
    const s = defaultState();
    s.config.locales = ["en", "fr"];
    createKey(s, "brand", "Glotfile");
    s.keys["brand"]!.skipTranslate = true;
    expect(findMissing(s)).toEqual([]);
  });
});

describe("loadUsageCache", () => {
  it("returns null when .glotfile/usage.json does not exist", () => {
    expect(loadUsageCache(tmpDir())).toBeNull();
  });

  it("returns null when usage.json contains invalid JSON", () => {
    const dir = tmpDir();
    mkdirSync(join(dir, ".glotfile"), { recursive: true });
    writeFileSync(join(dir, ".glotfile", "usage.json"), "not json");
    expect(loadUsageCache(dir)).toBeNull();
  });

  it("returns the parsed cache when usage.json is valid", () => {
    const dir = tmpDir();
    mkdirSync(join(dir, ".glotfile"), { recursive: true });
    const cache = {
      version: 1,
      scannedAt: "2026-06-08T10:00:00.000Z",
      files: {
        "app/Http/AuthController.php": {
          mtime: 1000,
          size: 200,
          refs: [{ key: "auth.signIn", line: 10, col: 5, scanner: "laravel" }],
          prefixes: [],
        },
      },
    };
    writeFileSync(join(dir, ".glotfile", "usage.json"), JSON.stringify(cache));
    expect(loadUsageCache(dir)).toEqual(cache);
  });
});

describe("computeUsedKeys", () => {
  const cache: UsageCacheFile = {
    version: 1,
    scannedAt: "2026-06-08T00:00:00.000Z",
    files: {
      "app/Foo.php": {
        mtime: 1, size: 1,
        refs: [{ key: "auth.login", line: 1, col: 1, scanner: "laravel" }],
        prefixes: [],
      },
      "app/Bar.php": {
        mtime: 1, size: 1,
        refs: [],
        prefixes: [{ prefix: "messages.", line: 1, col: 1, scanner: "laravel" }],
      },
    },
  };

  function stateWith(...keys: string[]) {
    const s = defaultState();
    for (const k of keys) createKey(s, k, "v");
    return s;
  }

  it("treats an exact reference as used", () => {
    const s = stateWith("auth.login", "auth.unused");
    expect(computeUsedKeys(s, cache)).toEqual(["auth.login"]);
  });

  it("treats a prefix-only match as used (conservative)", () => {
    const s = stateWith("messages.welcome", "other.key");
    expect(computeUsedKeys(s, cache)).toEqual(["messages.welcome"]);
  });

  it("returns the sorted used keys including both exact and prefix matches", () => {
    const s = stateWith("messages.welcome", "auth.login", "dead.key");
    expect(computeUsedKeys(s, cache)).toEqual(["auth.login", "messages.welcome"]);
  });

  it("returns no keys when the cache has no files", () => {
    const empty: UsageCacheFile = { version: 1, scannedAt: "x", files: {} };
    expect(computeUsedKeys(stateWith("a", "b"), empty)).toEqual([]);
  });

  it("ignores empty prefixes so they never mark every key used", () => {
    const c: UsageCacheFile = {
      version: 1, scannedAt: "x",
      files: { "f.php": { mtime: 1, size: 1, refs: [], prefixes: [{ prefix: "", line: 1, col: 1, scanner: "laravel" }] } },
    };
    expect(computeUsedKeys(stateWith("a"), c)).toEqual([]);
  });

  it("treats a key matching a scan.keep glob as used even with no references", () => {
    const s = stateWith("auth.throttle", "validation.required", "dead.key");
    s.config.scan = { keep: ["auth.throttle", "validation.*"] };
    const empty: UsageCacheFile = { version: 1, scannedAt: "x", files: {} };
    expect(computeUsedKeys(s, empty)).toEqual(["auth.throttle", "validation.required"]);
  });

  it("does not let a keep glob match across its literal text only as a prefix", () => {
    const s = stateWith("auth.throttle.extra", "auth.throttleX");
    s.config.scan = { keep: ["auth.throttle"] };
    const empty: UsageCacheFile = { version: 1, scannedAt: "x", files: {} };
    expect(computeUsedKeys(s, empty)).toEqual([]);
  });

  it("combines keep globs with scanned references", () => {
    const s = stateWith("auth.login", "auth.throttle", "dead.key");
    s.config.scan = { keep: ["auth.throttle"] };
    expect(computeUsedKeys(s, cache)).toEqual(["auth.login", "auth.throttle"]);
  });

  function cacheWithLiterals(...literals: string[]): UsageCacheFile {
    return {
      version: 1, scannedAt: "x",
      files: {
        "f.php": {
          mtime: 1, size: 1, refs: [], prefixes: [],
          literals: literals.map((l, i) => ({ literal: l, line: i + 1, col: 1 })),
        },
      },
    };
  }

  it("treats an exact literal match as used", () => {
    const s = stateWith("sms/plant-watered.message", "dead.key");
    expect(computeUsedKeys(s, cacheWithLiterals("sms/plant-watered.message"))).toEqual(["sms/plant-watered.message"]);
  });

  it("treats a literal as a prefix for keys nested under it", () => {
    const s = stateWith("emails/plant-watered.delivery.title", "emails/plant-watered.standard.title", "dead.key");
    expect(computeUsedKeys(s, cacheWithLiterals("emails/plant-watered.delivery"))).toEqual(["emails/plant-watered.delivery.title"]);
  });

  it("treats a trailing-dot literal (interpolation head) as a prefix", () => {
    const s = stateWith("emails/export-complete.subjects.HistoryExport", "dead.key");
    expect(computeUsedKeys(s, cacheWithLiterals("emails/export-complete.subjects."))).toEqual(["emails/export-complete.subjects.HistoryExport"]);
  });

  it("matches %s placeholders as single-segment wildcards", () => {
    const s = stateWith("messages.notification.delivery.title", "messages.notification.delivery.extra.title", "dead.key");
    expect(computeUsedKeys(s, cacheWithLiterals("messages.notification.%s.title"))).toEqual(["messages.notification.delivery.title"]);
  });

  it("does not let a literal match on a partial segment", () => {
    const s = stateWith("auth.throttleX");
    expect(computeUsedKeys(s, cacheWithLiterals("auth.throttle"))).toEqual([]);
  });

  it("tolerates cache files without a literals array (older caches)", () => {
    const s = stateWith("auth.login");
    expect(computeUsedKeys(s, cache)).toEqual(["auth.login"]);
  });
});
